// DuckDuckGo HTML result parsing (WebSearchProvider).
// Uses TestSupport (Check, StubHandler, …). Run by Program.cs.

using System.Net;
using System.Text;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;
using static TestSupport;

internal static class WebSearchTests
{
    public static async Task RunAsync()
    {
        var searchProvider = new WebSearchProvider(new HttpClient(new StubHandler((request, _) =>
        {
            Check(request.RequestUri?.Host == "html.duckduckgo.com", "opt-in web search uses the configured public search endpoint");
            var html = "<a class=\"result__a\" href=\"//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fdocs&amp;rut=abc\">Local &amp; private</a><a class=\"result__snippet\">Read <b>official</b> docs.</a>";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(html) });
        })));
        var searchResults = await searchProvider.SearchAsync("Uno Linux");
        Check(searchResults.Count == 1 && searchResults[0].Title == "Local & private", "web search decodes and extracts result titles");
        Check(searchResults[0].Url == "https://example.org/docs" && searchResults[0].Snippet == "Read official docs.", "web search returns safe HTTP source URLs and clean snippets");

        var target = "https://example.org/people/rhett";
        var targetToken = "a1" + Convert.ToBase64String(Encoding.UTF8.GetBytes(target)).TrimEnd('=');
        var bingSearchProvider = new WebSearchProvider(new HttpClient(new StubHandler((request, _) =>
        {
            var html = request.RequestUri?.Host == "html.duckduckgo.com"
                ? "<html>No results</html>"
                : $"<ol><li class=\"b_algo\"><h2><a href=\"https://www.bing.com/ck/a?u={targetToken}&amp;ntb=1\">Rhett McLaughlin</a></h2><p>Official profile.</p></li></ol>";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(html) });
        })));
        var bingResults = await bingSearchProvider.SearchAsync("Rhett McLaughlin");
        Check(bingResults.Count == 1 && bingResults[0].Url == target, "Bing tracking links are unwrapped to the original public source before use");

        Check(WebSearchProvider.NormalizePublicResearchUrl("https://www.bing.com/ck/a?u=broken") is null,
            "unresolved Bing redirect URLs are rejected as research sources");
        Check(WebSearchProvider.NormalizePublicResearchUrl("https://example.org/profile") == "https://example.org/profile",
            "direct public research links are preserved after normalization");
        Check(WebSearchProvider.NormalizePublicResearchUrl("https://joeroganpodcast.org/episodes/2482-andy-stumpf/transcript") == "https://joeroganpodcast.org/episodes/2482-andy-stumpf/transcript",
            "selected client-rendered transcript links survive URL normalization");

        const string anonKey = "eyJtest.eyJtest.signature";
        var archiveProvider = new WebSearchProvider(new HttpClient(new StubHandler((request, _) =>
        {
            var uri = request.RequestUri!;
            if (uri.Host == "joeroganpodcast.org" && uri.AbsolutePath == "/")
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<script type=\"module\" src=\"/assets/index-test.js\"></script>") });
            if (uri.Host == "joeroganpodcast.org" && uri.AbsolutePath == "/assets/index-test.js")
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent($"const endpoint=\"https://abc.supabase.co\";const key=\"{anonKey}\";") });
            if (uri.Host == "abc.supabase.co" && uri.AbsolutePath == "/rest/v1/episodes")
            {
                var transcript = string.Join("\n", new[] { "00:00:00", "00:00:45", "00:01:20", "00:02:05" }
                    .Select(timestamp => $"Starting point is {timestamp} " + string.Join(' ', Enumerable.Repeat("substantial conversation text for transcript testing", 6))));
                var payload = System.Text.Json.JsonSerializer.Serialize(new[] { new { title = "#1996 - Andy Stumpf", guest = "Andy Stumpf", date = "2024-01-01", transcript } });
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(payload, Encoding.UTF8, "application/json") });
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        })));
        var archiveTranscript = await archiveProvider.FetchTextAsync("https://joeroganpodcast.org/episodes/2482-andy-stumpf/transcript");
        Check(archiveTranscript?.Title.Contains("Andy Stumpf", StringComparison.Ordinal) == true,
            "client-rendered podcast transcript page resolves to its public transcript record");
        Check(archiveTranscript?.SourceType == "Unattributed conversation transcript"
            && archiveTranscript.SpeakerAttribution == "unattributed-mixed-speakers"
            && archiveTranscript.AttributedTurnCount == 0,
            "mixed-speaker podcast text is never mislabeled as speaker-attributed dialogue");
        Check(archiveTranscript?.Text.Contains("Starting point is 00:01:20", StringComparison.Ordinal) == true,
            "transcript extraction preserves actual timestamped speech turns");

        var labeledTranscript = string.Join("\n", new[]
        {
            "Joe Rogan (0:00)", "That is a substantial labeled turn from Joe for this test.",
            "Jamie Vernon (0:12)", "A separate substantial labeled turn from another speaker.",
            "Joe Rogan (0:25)", "Here is Joe's second substantial labeled turn in the sample.",
            "Joe Rogan (0:42)", "And a third distinct, attributed response from the host."
        });
        Check(PersonaDialogueEvidence.HasTranscriptStructure(labeledTranscript),
            "speaker-and-timestamp transcript formatting is recognized as dialogue structure");
        var joeAttribution = PersonaDialogueEvidence.DetectSubjectSpeaker("Joe Rogan", labeledTranscript);
        Check(joeAttribution.IsUsable && joeAttribution.TurnCount == 3,
            "speaker-label analysis counts only turns explicitly labeled as the requested person");
        var mixedAttribution = PersonaDialogueEvidence.DetectSubjectSpeaker("Joe Rogan", archiveTranscript?.Text ?? string.Empty);
        Check(!mixedAttribution.IsUsable,
            "timestamps and mentions of a person do not imply speaker attribution");
        Check(!PersonaDialogueEvidence.IsUsableSpeechEvidence("Unattributed conversation transcript", "unattributed-mixed-speakers", 0)
            && !PersonaDialogueEvidence.IsUsableSpeechEvidence("Conversation transcript", "subject-attributed", 2),
            "transcript excerpts are rejected for voice use unless three or more speaker-labeled turns are present");
        Check(PersonaDialogueEvidence.IsUsableSpeechEvidence("Conversation transcript", "subject-attributed", 3),
            "a transcript with three explicitly attributed turns passes the speech-evidence gate");
        var unverifiedPersona = new SavedPersona
        {
            Name = "Joe Rogan",
            SourceMode = "public-research",
            Sources = [new SavedPersonaSource { Title = "Mixed episode", Url = "https://example.org/mixed", Type = "Unattributed conversation transcript", SpeakerAttribution = "unattributed-mixed-speakers", Excerpt = "Unattributed guest speech about a topic." }],
        };
        Check(!ModelInstructions.PersonaSimulation(unverifiedPersona, "topic").Contains("https://example.org/mixed", StringComparison.Ordinal),
            "unattributed transcript content is kept out of the persona chat prompt");
        Check(PersonaDialogueEvidence.RequiresUnsupportedMemoryBoundary(unverifiedPersona, "Tell me about your childhood.")
            && PersonaDialogueEvidence.RequiresUnsupportedMemoryBoundary(unverifiedPersona, "Have you ever met Bill Burr?"),
            "unsupported childhood and lived-experience questions are held at the evidence boundary");
        var joeMemoryPersona = new SavedPersona
        {
            Name = "Joe Rogan",
            SourceMode = "public-research",
            Sources = [new SavedPersonaSource { Type = "Conversation transcript", SpeakerAttribution = "subject-attributed", Excerpt = "I competed in my first martial arts tournament in 1995, and I was nervous before the opening match." }],
        };
        Check(!PersonaDialogueEvidence.RequiresUnsupportedMemoryBoundary(joeMemoryPersona, "What was your first martial arts tournament like?")
            && PersonaDialogueEvidence.RequiresUnsupportedMemoryBoundary(joeMemoryPersona, "What was your first martial arts tournament in Brazil like?"),
            "a personal-memory answer requires all query anchors to co-occur in a directly attributed evidence segment");
        var jackMemoryPersona = new SavedPersona
        {
            Name = "Captain Jack Sparrow",
            SubjectType = "character",
            SourceMode = "public-research",
            Sources = [new SavedPersonaSource { Type = "Story transcript", SpeakerAttribution = "subject-attributed", Excerpt = "I got the compass from Tia Dalma after I promised to return it." }],
        };
        Check(!PersonaDialogueEvidence.RequiresUnsupportedMemoryBoundary(jackMemoryPersona, "How did you get the compass?")
            && PersonaDialogueEvidence.RequiresUnsupportedMemoryBoundary(jackMemoryPersona, "How did you get the compass, and what did you want from it?"),
            "memory questions requiring multiple claims need evidence for the acquisition and intent together");

        var speakerPageProvider = new WebSearchProvider(new HttpClient(new StubHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<html><head><title>Podcast transcript</title></head><body><article><p>Joe Rogan (0:00)</p><p>That is a substantial speaker-labeled turn from Joe.</p><p>Jamie Vernon (0:12)</p><p>This line belongs to the other speaker instead.</p><p>Joe Rogan (0:25)</p><p>This is another substantial response from Joe here.</p><p>Joe Rogan (0:42)</p><p>A third labeled response is included for validation.</p></article></body></html>")
        }))));
        var speakerPage = await speakerPageProvider.FetchTextAsync("https://spoken.md/transcripts/sample");
        var pageAttribution = PersonaDialogueEvidence.DetectSubjectSpeaker("Joe Rogan", speakerPage?.Text ?? string.Empty);
        Check(pageAttribution.IsUsable && pageAttribution.TurnCount == 3,
            "HTML transcript extraction preserves speaker-turn boundaries for attribution checks");

        var pdfBuilder = new PdfDocumentBuilder();
        var pdfPage = pdfBuilder.AddPage(PageSize.A4);
        var pdfFont = pdfBuilder.AddStandard14Font(Standard14Font.Helvetica);
        var labeledPdfTurns = new[]
        {
            "Joe Rogan: That is a substantial labeled transcript turn about the topic.",
            "Bill Burr: This separate speaker has a distinct response in the transcript.",
            "Joe Rogan: Here is a second long answer from the person being researched.",
            "Joe Rogan: Here is a third answer with enough text to verify the speaker.",
        };
        for (var index = 0; index < labeledPdfTurns.Length; index++)
            pdfPage.AddText(labeledPdfTurns[index], 10, new PdfPoint(25, 760 - index * 22), pdfFont);
        var pdfBytes = pdfBuilder.Build();
        var pdfTranscriptProvider = new WebSearchProvider(new HttpClient(new StubHandler((request, _) =>
        {
            var content = new ByteArrayContent(pdfBytes);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
            return Task.FromResult(request.RequestUri?.AbsolutePath == "/joe-interview.pdf"
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = content }
                : new HttpResponseMessage(HttpStatusCode.NotFound));
        })));
        var pdfTranscript = await pdfTranscriptProvider.FetchTextAsync("https://example.org/joe-interview.pdf");
        var pdfAttribution = PersonaDialogueEvidence.DetectSubjectSpeaker("Joe Rogan", pdfTranscript?.Text ?? string.Empty);
        Check(pdfTranscript?.SourceType == "Conversation transcript"
            && PersonaDialogueEvidence.HasTranscriptStructure(pdfTranscript.Text)
            && pdfAttribution.IsUsable && pdfAttribution.TurnCount == 3,
            "public speaker-labeled PDF transcripts are extracted locally and preserve role-attributed turns");
        var pdfJoeTurns = PersonaDialogueEvidence.SelectAttributedSpeakerTurns("Joe Rogan", pdfTranscript?.Text ?? string.Empty);
        Check(pdfJoeTurns.Contains("That is a substantial labeled transcript", StringComparison.Ordinal)
            && !pdfJoeTurns.Contains("This separate speaker", StringComparison.Ordinal),
            "PDF transcript excerpts exclude lines attributed to the other speaker");

        var screenplay = "JACK SPARROW\nWe should make our way to the ship before dawn.\nWILL TURNER\nI have a different plan.\nJACK SPARROW\nThen we'll take the long way around.\nJACK SPARROW\nAnd I have another point to make.";
        var jackAttribution = PersonaDialogueEvidence.DetectSubjectSpeaker("Captain Jack Sparrow", screenplay);
        var jackTurns = PersonaDialogueEvidence.SelectAttributedSpeakerTurns("Captain Jack Sparrow", screenplay);
        Check(PersonaDialogueEvidence.HasTranscriptStructure(screenplay) && jackAttribution.IsUsable && jackAttribution.TurnCount == 3,
            "screenplay character headings resolve honorific names to explicit speaker turns");
        Check(jackTurns.Contains("Jack Sparrow: We should make our way", StringComparison.Ordinal)
            && !jackTurns.Contains("I have a different plan", StringComparison.Ordinal),
            "dialogue excerpts keep the selected character's lines separate from other speakers");
        var abbreviatedScreenplay = "JACK\nThat is a complete response from Jack Sparrow in this sample.\nJack walks toward the harbor, checking the ship before he leaves.\nELIZABETH SWANN\nThis line belongs to Elizabeth and must not be included.\nJACK\nThis is Jack's second response, with another full sentence.\nJACK\nAnd here is the third line spoken by the character.";
        var abbreviatedJackTurns = PersonaDialogueEvidence.SelectAttributedSpeakerTurns("Captain Jack Sparrow", abbreviatedScreenplay);
        Check(PersonaDialogueEvidence.DetectSubjectSpeaker("Captain Jack Sparrow", abbreviatedScreenplay).IsUsable
            && abbreviatedJackTurns.Contains("Jack Sparrow: That is a complete response", StringComparison.Ordinal)
            && !abbreviatedJackTurns.Contains("This line belongs to Elizabeth", StringComparison.Ordinal)
            && !abbreviatedJackTurns.Contains("walks toward the harbor", StringComparison.Ordinal),
            "Captain Jack Sparrow screenplay sources accept the character's JACK cue while excluding other cast members and action descriptions");
    }
}
