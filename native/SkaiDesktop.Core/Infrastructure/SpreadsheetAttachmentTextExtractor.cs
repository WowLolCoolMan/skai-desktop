// Bounded local extraction of cached cell values from Open XML workbooks.
// Used by: the Agent Host attachment extraction protocol.

using System.IO.Compression;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Extracts a small, readable sample from an .xlsx workbook without executing formulas.</summary>
public static class SpreadsheetAttachmentTextExtractor
{
    public const int MaxWorkbookBytes = 20 * 1024 * 1024;
    public const int MaxXmlEntryBytes = 8 * 1024 * 1024;
    public const int MaxSheets = 8;
    public const int MaxRowsPerSheet = 200;
    public const int MaxCellsPerRow = 50;
    private static readonly XNamespace SpreadsheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace OfficeRelationshipsNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace PackageRelationshipsNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";

    public static bool HasZipSignature(ReadOnlySpan<byte> bytes) =>
        bytes.Length >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4B && bytes[2] is 0x03 or 0x05 or 0x07;

    public static string Extract(ReadOnlyMemory<byte> workbookBytes, int maxCharacters)
    {
        if (!HasZipSignature(workbookBytes.Span)) throw new InvalidDataException("This file is not a valid Open XML spreadsheet archive.");
        if (workbookBytes.Length > MaxWorkbookBytes) throw new InvalidDataException("The spreadsheet exceeds the 20 MB local extraction limit.");
        if (maxCharacters <= 0) return string.Empty;

        using var memory = new MemoryStream(workbookBytes.ToArray(), writable: false);
        using var archive = new ZipArchive(memory, ZipArchiveMode.Read, leaveOpen: false);
        if (archive.Entries.Count is 0 or > 2_000) throw new InvalidDataException("The spreadsheet has an invalid number of archive entries.");
        var entries = archive.Entries.ToDictionary(entry => entry.FullName, StringComparer.Ordinal);
        if (!entries.TryGetValue("xl/workbook.xml", out var workbookEntry)) throw new InvalidDataException("The spreadsheet is missing its workbook metadata.");

        var workbook = LoadXml(workbookEntry);
        var sharedStrings = entries.TryGetValue("xl/sharedStrings.xml", out var sharedStringsEntry)
            ? ReadSharedStrings(LoadXml(sharedStringsEntry))
            : [];
        var relationships = entries.TryGetValue("xl/_rels/workbook.xml.rels", out var relationshipEntry)
            ? LoadXml(relationshipEntry).Root?.Elements(PackageRelationshipsNamespace + "Relationship")
                .Where(element => element.Attribute("Id") is not null && element.Attribute("Target") is not null)
                .ToDictionary(element => (string)element.Attribute("Id")!, element => (string)element.Attribute("Target")!, StringComparer.Ordinal)
                ?? new Dictionary<string, string>(StringComparer.Ordinal)
            : new Dictionary<string, string>(StringComparer.Ordinal);

        var sheets = workbook.Root?.Element(SpreadsheetNamespace + "sheets")?.Elements(SpreadsheetNamespace + "sheet")
            .Take(MaxSheets + 1).ToArray() ?? [];
        if (sheets.Length > MaxSheets) sheets = sheets[..MaxSheets];
        var output = new StringBuilder(Math.Min(maxCharacters, 4096));
        foreach (var sheet in sheets)
        {
            if (output.Length >= maxCharacters) break;
            var name = ((string?)sheet.Attribute("name"))?.Trim();
            var relationId = (string?)sheet.Attribute(OfficeRelationshipsNamespace + "id");
            if (string.IsNullOrWhiteSpace(name) || relationId is null || !relationships.TryGetValue(relationId, out var target)) continue;
            var path = ResolveSheetPath(target);
            if (!entries.TryGetValue(path, out var sheetEntry)) continue;
            var sheetDocument = LoadXml(sheetEntry);
            AppendBounded(output, $"\n\n[Sheet: {name}]\n", maxCharacters);
            var rows = sheetDocument.Root?.Element(SpreadsheetNamespace + "sheetData")?.Elements(SpreadsheetNamespace + "row")
                .Take(MaxRowsPerSheet + 1).ToArray() ?? [];
            foreach (var row in rows.Take(MaxRowsPerSheet))
            {
                if (output.Length >= maxCharacters) break;
                var cells = row.Elements(SpreadsheetNamespace + "c").Take(MaxCellsPerRow)
                    .Select(cell =>
                    {
                        var value = ReadCell(cell, sharedStrings).Replace('\r', ' ').Replace('\n', ' ').Replace('\t', ' ').Trim();
                        if (value.Length == 0) return null;
                        var address = ((string?)cell.Attribute("r"))?.Trim();
                        return string.IsNullOrWhiteSpace(address) ? value : $"{address}={value}";
                    }).Where(value => value is not null).ToArray();
                if (cells.Length == 0) continue;
                var line = string.Join("\t", cells).TrimEnd();
                if (line.Length > 0) AppendBounded(output, line + "\n", maxCharacters);
            }
            if (rows.Length > MaxRowsPerSheet && output.Length < maxCharacters)
                AppendBounded(output, "[Additional rows omitted.]\n", maxCharacters);
        }
        var result = output.ToString().Trim();
        if (result.Length == 0) throw new InvalidDataException("No readable worksheet cells were found in this spreadsheet.");
        return result.Length <= maxCharacters ? result : result[..maxCharacters];
    }

    private static string ResolveSheetPath(string target)
    {
        var normalized = target.Replace('\\', '/');
        if (normalized.StartsWith('/')) normalized = normalized[1..];
        else if (!normalized.StartsWith("xl/", StringComparison.OrdinalIgnoreCase)) normalized = "xl/" + normalized;
        if (normalized.Split('/').Any(segment => segment is "" or "." or ".."))
            throw new InvalidDataException("The spreadsheet contains an invalid worksheet path.");
        return normalized;
    }

    private static XDocument LoadXml(ZipArchiveEntry entry)
    {
        if (entry.Length > MaxXmlEntryBytes) throw new InvalidDataException("A spreadsheet XML part exceeds the 8 MB extraction limit.");
        using var input = entry.Open();
        using var output = new MemoryStream((int)Math.Min(entry.Length, MaxXmlEntryBytes));
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var read = input.Read(buffer, 0, buffer.Length);
            if (read == 0) break;
            if (output.Length + read > MaxXmlEntryBytes) throw new InvalidDataException("A spreadsheet XML part exceeds the 8 MB extraction limit.");
            output.Write(buffer, 0, read);
        }
        output.Position = 0;
        using var reader = XmlReader.Create(output, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = MaxXmlEntryBytes });
        return XDocument.Load(reader, LoadOptions.None);
    }

    private static string[] ReadSharedStrings(XDocument document) =>
        document.Root?.Elements(SpreadsheetNamespace + "si").Take(100_001).Select(item => string.Concat(
            item.Descendants(SpreadsheetNamespace + "t").Select(text => text.Value))).Take(100_000).ToArray() ?? [];

    private static string ReadCell(XElement cell, string[] sharedStrings)
    {
        var type = (string?)cell.Attribute("t");
        if (type == "inlineStr") return string.Concat(cell.Descendants(SpreadsheetNamespace + "t").Select(text => text.Value));
        var value = (string?)cell.Element(SpreadsheetNamespace + "v") ?? string.Empty;
        if (type == "s" && int.TryParse(value, out var index)) return (uint)index < (uint)sharedStrings.Length ? sharedStrings[index] : string.Empty;
        if (type == "b") return value == "1" ? "TRUE" : value == "0" ? "FALSE" : string.Empty;
        return value;
    }

    private static void AppendBounded(StringBuilder output, string value, int maximum)
    {
        var remaining = maximum - output.Length;
        if (remaining > 0) output.Append(value.AsSpan(0, Math.Min(value.Length, remaining)));
    }
}
