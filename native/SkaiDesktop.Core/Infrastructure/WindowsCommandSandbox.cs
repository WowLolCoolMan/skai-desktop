using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Google.FlatBuffers;
using Microsoft.Win32.SafeHandles;
using ProcessSecurityEnvironmentLayout;

namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Starts a Windows command with PSEC path grants, AppContainer network isolation, and a bounded Job Object.</summary>
internal sealed class WindowsCommandSandbox : IDisposable
{
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint HandleFlagInherit = 1;
    private const uint ProcThreadAttributeHandleList = 0x00020002;
    private const uint ProcThreadAttributeSecurityEnvironment = 0x00020023;
    private static readonly uint HResultAlreadyExists = unchecked((uint)0x800700B7);
    private static readonly Lazy<ProcessModelApi> ProcessModel = new(LoadProcessModelApi, LazyThreadSafetyMode.ExecutionAndPublication);
    private readonly SafeFileHandle outputHandle;
    private readonly StreamReader outputReader;
    private readonly IntPtr securityEnvironment;
    private readonly CloseProcessSecurityEnvironmentDelegate closeSecurityEnvironment;

    private WindowsCommandSandbox(Process process, OsProcessIsolation isolation, SafeFileHandle outputHandle, IntPtr securityEnvironment, CloseProcessSecurityEnvironmentDelegate closeSecurityEnvironment)
    {
        Process = process;
        Isolation = isolation;
        this.outputHandle = outputHandle;
        outputReader = new StreamReader(new FileStream(outputHandle, FileAccess.Read), Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        this.securityEnvironment = securityEnvironment;
        this.closeSecurityEnvironment = closeSecurityEnvironment;
    }

    public Process Process { get; }
    public OsProcessIsolation Isolation { get; }
    public TextReader StandardOutput => outputReader;
    public TextReader StandardError => TextReader.Null;
    public string Status => $"Windows Process Security Environment active (selected project writable; runtime paths read-only; network denied by capability-free AppContainer; maximum {OsProcessIsolation.MaxActiveProcesses} processes; CPU quota {Isolation.CpuQuotaPercent ?? 0}% ({Math.Clamp(Environment.ProcessorCount, 1, OsProcessIsolation.MaxCpuCores)} cores); job memory cap {FormatGigabytes(Isolation.JobMemoryLimitBytes ?? 0)} GiB).";

    [SupportedOSPlatform("windows")]
    public static WindowsCommandSandbox Start(string projectRoot, string workingDirectory, string command, IEnumerable<KeyValuePair<string, string?>> environment, ulong? memoryLimitBytesOverride)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("The Windows process security environment is available only on Windows.");
        var normalizedRoot = Path.GetFullPath(projectRoot);
        var normalizedWorkingDirectory = Path.GetFullPath(workingDirectory);
        EnsureSafeWorkspacePath(normalizedRoot);
        if (!IsWithin(normalizedRoot, normalizedWorkingDirectory)) throw new UnauthorizedAccessException("The selected command directory escapes the project root.");
        EnsureNoReparsePoints(normalizedWorkingDirectory);

        var identity = CreateProfileName(normalizedRoot);
        var appContainerSid = CreateOrDeriveProfileSid(identity);
        IntPtr psecSpecification = IntPtr.Zero;
        IntPtr securityEnvironment = IntPtr.Zero;
        Process? process = null;
        OsProcessIsolation? isolation = null;
        SafeFileHandle? outputRead = null;
        var processModel = ProcessModel.Value;
        var closeEnvironment = processModel.Close;
        try
        {
            var appContainerPath = GetAppContainerFolderPath(new SecurityIdentifier(appContainerSid).Value);
            var appContainerTemp = Path.Combine(appContainerPath, "Temp");
            Directory.CreateDirectory(appContainerTemp);
            var childEnvironment = BuildChildEnvironment(environment, appContainerPath, appContainerTemp);
            var specification = BuildSpecification(normalizedRoot, childEnvironment);
            psecSpecification = Marshal.AllocHGlobal(specification.Length);
            Marshal.Copy(specification, 0, psecSpecification, specification.Length);
            var createResult = processModel.Create(psecSpecification, checked((uint)specification.Length), 0, out securityEnvironment);
            if (createResult < 0 || securityEnvironment == IntPtr.Zero)
                Marshal.ThrowExceptionForHR(createResult < 0 ? createResult : unchecked((int)0x80004005));

            (process, isolation, outputRead) = CreateSuspendedCommand(normalizedWorkingDirectory, command, childEnvironment, securityEnvironment, memoryLimitBytesOverride);
            return new WindowsCommandSandbox(process, isolation, outputRead, securityEnvironment, closeEnvironment);
        }
        catch
        {
            if (process is not null)
            {
                try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
                process.Dispose();
            }
            isolation?.Dispose();
            outputRead?.Dispose();
            if (securityEnvironment != IntPtr.Zero) closeEnvironment(securityEnvironment);
            throw;
        }
        finally
        {
            if (psecSpecification != IntPtr.Zero) Marshal.FreeHGlobal(psecSpecification);
            FreeSid(appContainerSid);
        }
    }

    [SupportedOSPlatform("windows")]
    public void Dispose()
    {
        outputReader.Dispose();
        closeSecurityEnvironment(securityEnvironment);
    }

    private static byte[] BuildSpecification(string projectRoot, IEnumerable<KeyValuePair<string, string?>> environment)
    {
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        AddRuntimePath(paths, Environment.GetFolderPath(Environment.SpecialFolder.Windows));
        foreach (var pair in environment.Where(pair => string.Equals(pair.Key, "PATH", StringComparison.OrdinalIgnoreCase) && pair.Value is not null))
            foreach (var path in pair.Value!.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                AddRuntimePath(paths, path.Trim('"'));
        paths.RemoveWhere(path => IsWithin(projectRoot, path));

        var spec = new ProcessSecurityEnvironmentT
        {
            Version = new SchemaVersionT { Major = 1, Minor = 0 },
            FsReadWrite = [projectRoot],
            FsReadOnly = paths.OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToList(),
        };
        return spec.SerializeToBinary();
    }

    private static IEnumerable<KeyValuePair<string, string?>> BuildChildEnvironment(IEnumerable<KeyValuePair<string, string?>> environment, string appContainerPath, string appContainerTemp)
    {
        var values = environment.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
        values["LOCALAPPDATA"] = appContainerPath;
        values["APPDATA"] = Path.Combine(appContainerPath, "Roaming");
        values["TEMP"] = appContainerTemp;
        values["TMP"] = appContainerTemp;
        values["HOME"] = appContainerPath;
        values["USERPROFILE"] = appContainerPath;
        return values;
    }

    private static void AddRuntimePath(HashSet<string> paths, string candidate)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(candidate) && Directory.Exists(candidate)) paths.Add(Path.GetFullPath(candidate));
        }
        catch (Exception error) when (error is ArgumentException or IOException or UnauthorizedAccessException or NotSupportedException) { }
    }

    private static bool IsWithin(string root, string path)
    {
        var relative = Path.GetRelativePath(root, path);
        return relative == "." || (!Path.IsPathRooted(relative) && relative != ".." && !relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal));
    }

    private static void EnsureSafeWorkspacePath(string projectRoot)
    {
        EnsureNoReparsePoints(projectRoot);
        if (string.Equals(projectRoot, Path.GetPathRoot(projectRoot), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Windows Coding Agent commands cannot use a drive or share root as the writable project. Choose a dedicated project folder.");

        var protectedRoots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        };
        foreach (var protectedRoot in protectedRoots)
        {
            if (string.IsNullOrWhiteSpace(protectedRoot) || !Directory.Exists(protectedRoot)) continue;
            var normalizedProtectedRoot = Path.GetFullPath(protectedRoot);
            if (IsWithin(normalizedProtectedRoot, projectRoot))
                throw new InvalidOperationException("Windows Coding Agent commands cannot use a protected operating-system or application-data folder as the writable project. Choose a dedicated project folder.");
        }
    }

    private static void EnsureNoReparsePoints(string path)
    {
        var volumeRoot = Path.GetPathRoot(path)
            ?? throw new InvalidOperationException("Windows could not determine the selected project volume.");
        var currentPath = volumeRoot;
        try
        {
            foreach (var segment in path[volumeRoot.Length..].Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries))
            {
                currentPath = Path.Combine(currentPath, segment);
                if ((File.GetAttributes(currentPath) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("Windows Coding Agent commands cannot use a project path that traverses a symbolic link, junction, or mount point. Choose a direct project folder.");
            }
        }
        catch (InvalidOperationException)
        {
            throw;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            throw new InvalidOperationException("Windows could not verify that the selected project path avoids symbolic links, junctions, and mount points. The command was not executed.", error);
        }
    }

    private static (Process Process, OsProcessIsolation Isolation, SafeFileHandle OutputRead) CreateSuspendedCommand(
        string workingDirectory,
        string command,
        IEnumerable<KeyValuePair<string, string?>> environment,
        IntPtr securityEnvironment,
        ulong? memoryLimitBytesOverride)
    {
        var inputPipe = CreatePipeHandles(readInheritable: true, writeInheritable: false);
        using var standardInputRead = inputPipe.Read;
        using var standardInputWrite = inputPipe.Write;
        var outputPipe = CreatePipeHandles(readInheritable: false, writeInheritable: true);
        using var standardOutputRead = outputPipe.Read;
        using var standardOutputWrite = outputPipe.Write;
        var startupInfo = new StartupInfoEx
        {
            StartupInfo = new StartupInfo
            {
                Cb = Marshal.SizeOf<StartupInfoEx>(),
                Flags = StartfUseStdHandles,
                StandardInput = standardInputRead.DangerousGetHandle(),
                StandardOutput = standardOutputWrite.DangerousGetHandle(),
                StandardError = standardOutputWrite.DangerousGetHandle(),
            },
        };
        var attributeBytes = IntPtr.Zero;
        IntPtr environmentBlock = IntPtr.Zero;
        IntPtr environmentHandlePointer = IntPtr.Zero;
        IntPtr inheritedHandles = IntPtr.Zero;
        IntPtr processHandle = IntPtr.Zero;
        IntPtr primaryThreadHandle = IntPtr.Zero;
        SafeFileHandle? retainedOutput = null;
        Process? process = null;
        OsProcessIsolation? isolation = null;
        try
        {
            nuint attributeListBytes = 0;
            _ = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref attributeListBytes);
            attributeBytes = Marshal.AllocHGlobal(checked((int)attributeListBytes));
            if (!InitializeProcThreadAttributeList(attributeBytes, 2, 0, ref attributeListBytes)) throw LastError("InitializeProcThreadAttributeList failed.");
            environmentHandlePointer = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(environmentHandlePointer, securityEnvironment);
            if (!UpdateProcThreadAttribute(attributeBytes, 0, (IntPtr)ProcThreadAttributeSecurityEnvironment, environmentHandlePointer, (nuint)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))
                throw LastError("Windows could not attach the process security environment.");
            inheritedHandles = Marshal.AllocHGlobal(IntPtr.Size * 2);
            Marshal.WriteIntPtr(inheritedHandles, 0, standardInputRead.DangerousGetHandle());
            Marshal.WriteIntPtr(inheritedHandles, IntPtr.Size, standardOutputWrite.DangerousGetHandle());
            if (!UpdateProcThreadAttribute(attributeBytes, 0, (IntPtr)ProcThreadAttributeHandleList, inheritedHandles, (nuint)(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero))
                throw LastError("Windows could not restrict inherited command handles.");
            startupInfo.AttributeList = attributeBytes;

            var powershellPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            var commandLine = new StringBuilder(QuoteArgument(powershellPath) + " -NoLogo -NoProfile -NonInteractive -Command " + QuoteArgument(command));
            environmentBlock = BuildEnvironmentBlock(environment);
            if (!CreateProcessW(powershellPath, commandLine, IntPtr.Zero, IntPtr.Zero, true,
                CreateSuspended | CreateNoWindow | CreateUnicodeEnvironment | ExtendedStartupInfoPresent,
                environmentBlock, workingDirectory, ref startupInfo, out var processInfo))
                throw LastError("Windows could not create the isolated command process.");
            processHandle = processInfo.Process;
            primaryThreadHandle = processInfo.Thread;
            standardInputRead.Dispose();
            standardOutputWrite.Dispose();
            standardInputWrite.Dispose();

            process = Process.GetProcessById(checked((int)processInfo.ProcessId));
            isolation = OsProcessIsolation.Attach(process, memoryLimitBytesOverride);
            if (!isolation.IsAttached) throw new InvalidOperationException("Windows could not attach the isolated command to its process and memory job. The command was not started.");
            if (ResumeThread(primaryThreadHandle) == uint.MaxValue) throw LastError("Windows could not resume the isolated command process.");
            retainedOutput = new SafeFileHandle(standardOutputRead.DangerousGetHandle(), ownsHandle: true);
            standardOutputRead.SetHandleAsInvalid();
            return (process, isolation, retainedOutput);
        }
        catch
        {
            if (processHandle != IntPtr.Zero) TerminateProcess(processHandle, 1);
            process?.Dispose();
            isolation?.Dispose();
            retainedOutput?.Dispose();
            throw;
        }
        finally
        {
            if (primaryThreadHandle != IntPtr.Zero) CloseHandle(primaryThreadHandle);
            if (processHandle != IntPtr.Zero) CloseHandle(processHandle);
            if (attributeBytes != IntPtr.Zero) { DeleteProcThreadAttributeList(attributeBytes); Marshal.FreeHGlobal(attributeBytes); }
            if (environmentHandlePointer != IntPtr.Zero) Marshal.FreeHGlobal(environmentHandlePointer);
            if (inheritedHandles != IntPtr.Zero) Marshal.FreeHGlobal(inheritedHandles);
            if (environmentBlock != IntPtr.Zero) Marshal.FreeHGlobal(environmentBlock);
        }
    }

    private static (SafeFileHandle Read, SafeFileHandle Write) CreatePipeHandles(bool readInheritable, bool writeInheritable)
    {
        var attributes = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), InheritHandle = true };
        if (!CreatePipe(out var read, out var write, ref attributes, 0)) throw LastError("Windows could not create command output pipes.");
        var readHandle = new SafeFileHandle(read, ownsHandle: true);
        var writeHandle = new SafeFileHandle(write, ownsHandle: true);
        if ((!readInheritable && !SetHandleInformation(read, HandleFlagInherit, 0)) ||
            (!writeInheritable && !SetHandleInformation(write, HandleFlagInherit, 0)))
        {
            readHandle.Dispose();
            writeHandle.Dispose();
            throw LastError("Windows could not isolate command pipe handles.");
        }
        return (readHandle, writeHandle);
    }

    private static IntPtr CreateOrDeriveProfileSid(string profileName)
    {
        var result = CreateAppContainerProfile(profileName, "Skai Desktop Coding Agent", "Restricted project command sandbox", IntPtr.Zero, 0, out var sid);
        if (result == 0) return sid;
        if (unchecked((uint)result) == HResultAlreadyExists)
        {
            var deriveResult = DeriveAppContainerSidFromAppContainerName(profileName, out sid);
            if (deriveResult == 0 && sid != IntPtr.Zero) return sid;
            Marshal.ThrowExceptionForHR(deriveResult);
        }
        Marshal.ThrowExceptionForHR(result);
        throw new InvalidOperationException("Windows could not create the command AppContainer profile.");
    }

    private static string GetAppContainerFolderPath(string sid)
    {
        var result = GetAppContainerFolderPathNative(sid, out var pathPointer);
        if (result < 0) Marshal.ThrowExceptionForHR(result);
        try { return Marshal.PtrToStringUni(pathPointer) ?? throw new InvalidOperationException("Windows returned an empty AppContainer folder path."); }
        finally { CoTaskMemFree(pathPointer); }
    }

    private static ProcessModelApi LoadProcessModelApi()
    {
        var library = NativeLibrary.Load("processmodel.dll", typeof(WindowsCommandSandbox).Assembly, DllImportSearchPath.System32);
        if (!NativeLibrary.TryGetExport(library, "CreateProcessSecurityEnvironment", out var createAddress) ||
            !NativeLibrary.TryGetExport(library, "CloseProcessSecurityEnvironment", out var closeAddress))
        {
            NativeLibrary.Free(library);
            throw new PlatformNotSupportedException("This Windows build does not provide the OS Process Security Environment API required for Coding Agent commands.");
        }
        return new ProcessModelApi(
            Marshal.GetDelegateForFunctionPointer<CreateProcessSecurityEnvironmentDelegate>(createAddress),
            Marshal.GetDelegateForFunctionPointer<CloseProcessSecurityEnvironmentDelegate>(closeAddress));
    }

    private static IntPtr BuildEnvironmentBlock(IEnumerable<KeyValuePair<string, string?>> environment)
    {
        var entries = environment.Where(pair => pair.Value is not null)
            .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
            .Select(pair => $"{pair.Key}={pair.Value}");
        return Marshal.StringToHGlobalUni(string.Join('\0', entries) + "\0\0");
    }

    [SupportedOSPlatform("windows")]
    private static string CreateProfileName(string projectRoot)
    {
        using var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
        var key = $"{identity.User?.Value}\n{Path.GetFullPath(projectRoot)}";
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)))[..32];
        return "SkaiDesktop.Coding." + digest;
    }

    private static string QuoteArgument(string value)
    {
        var result = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var character in value)
        {
            if (character == '\\') { backslashes++; continue; }
            if (character == '"') result.Append('\\', backslashes * 2 + 1);
            else result.Append('\\', backslashes);
            result.Append(character);
            backslashes = 0;
        }
        result.Append('\\', backslashes * 2).Append('"');
        return result.ToString();
    }

    private static Win32Exception LastError(string message) => new(Marshal.GetLastWin32Error(), message);
    private static string FormatGigabytes(ulong bytes) => (bytes / (1024d * 1024 * 1024)).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate int CreateProcessSecurityEnvironmentDelegate(IntPtr specification, uint specificationSizeBytes, uint flags, out IntPtr securityEnvironment);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void CloseProcessSecurityEnvironmentDelegate(IntPtr securityEnvironment);
    private sealed record ProcessModelApi(CreateProcessSecurityEnvironmentDelegate Create, CloseProcessSecurityEnvironmentDelegate Close);
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int Length; public IntPtr SecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle; }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInfo
    {
        public int Cb; public string? Reserved; public string? Desktop; public string? Title; public int X; public int Y; public int XSize; public int YSize;
        public int XCountChars; public int YCountChars; public int FillAttribute; public uint Flags; public short ShowWindow; public short Reserved2Size;
        public IntPtr Reserved2; public IntPtr StandardInput; public IntPtr StandardOutput; public IntPtr StandardError;
    }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx { public StartupInfo StartupInfo; public IntPtr AttributeList; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { public IntPtr Process; public IntPtr Thread; public uint ProcessId; public uint ThreadId; }

    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SecurityAttributes attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateProcessW")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcessW(string? applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfoEx startupInfo, out ProcessInformation processInformation);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool InitializeProcThreadAttributeList(IntPtr attributeList, int attributeCount, uint flags, ref nuint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UpdateProcThreadAttribute(IntPtr attributeList, uint flags, IntPtr attribute, IntPtr value, nuint size, IntPtr previousValue, IntPtr returnSize);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int CreateAppContainerProfile(string name, string displayName, string description, IntPtr capabilities, uint capabilityCount, out IntPtr appContainerSid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr appContainerSid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode, EntryPoint = "GetAppContainerFolderPath")] private static extern int GetAppContainerFolderPathNative(string sid, out IntPtr path);
    [DllImport("ole32.dll")] private static extern void CoTaskMemFree(IntPtr memory);
    [DllImport("advapi32.dll")] private static extern IntPtr FreeSid(IntPtr sid);
}
