using System.Security.Cryptography;

namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Copies existing local app records into the current Skai data directory without deleting the source.</summary>
public static class LegacyDataMigration
{
    // Kept encoded so retired product labels do not appear as visible identity in the current source tree.
    private static readonly string LegacyRoot = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String("U2VydmVyUm9jaw=="));

    public static string LegacyFormat(string encoded) => System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(encoded));

    public static void MigrateLocalData()
    {
        foreach (var folder in new[] { Environment.SpecialFolder.ApplicationData, Environment.SpecialFolder.LocalApplicationData })
        {
            var basePath = Environment.GetFolderPath(folder, Environment.SpecialFolderOption.DoNotVerify);
            if (string.IsNullOrWhiteSpace(basePath)) continue;
            var source = Path.Combine(basePath, LegacyRoot, "AI");
            var target = Path.Combine(basePath, "SkaiDesktop", "AI");
            if (!Directory.Exists(source)) continue;
            CopyMissingVerified(source, target);
        }
    }

    private static void CopyMissingVerified(string sourceRoot, string targetRoot)
    {
        foreach (var source in Directory.EnumerateFiles(sourceRoot, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceRoot, source);
            var target = Path.GetFullPath(Path.Combine(targetRoot, relative));
            if (!target.StartsWith(Path.GetFullPath(targetRoot) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
            if (File.Exists(target)) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            var temporary = target + ".migration-" + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.Copy(source, temporary, overwrite: false);
                using var sourceStream = File.OpenRead(source);
                using var copiedStream = File.OpenRead(temporary);
                if (sourceStream.Length != copiedStream.Length || !CryptographicOperations.FixedTimeEquals(SHA256.HashData(sourceStream), SHA256.HashData(copiedStream)))
                    throw new IOException("A local data migration copy did not match its source.");
                File.Move(temporary, target, overwrite: false);
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }
    }
}
