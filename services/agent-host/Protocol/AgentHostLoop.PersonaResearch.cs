using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;
public static partial class AgentHostLoop
{
    /// <summary>
    /// Picks the identity to research: the match the user selected in discovery (by URL), else a
    /// confident resolution of the name. Returns null when nothing matches well enough, in which
    /// case research falls back to web search alone.
    /// </summary>
    private static async Task<PersonaIdentity?> ResolveResearchIdentityAsync(PersonaKnowledgeSources knowledge, string query, string notes, string subjectType, IReadOnlyList<string> requestedUrls, CancellationToken cancellationToken)
    {
        var typedAlias = Regex.Match(notes, @"Search name or alias:\s*(?<alias>[^\r\n]+)").Groups["alias"].Value.Trim();
        var identities = await knowledge.ResolveAsync(query, subjectType, cancellationToken).ConfigureAwait(false);
        if (identities.Count == 0 && typedAlias.Length > 0) identities = await knowledge.ResolveAsync(typedAlias, subjectType, cancellationToken).ConfigureAwait(false);
        static string Key(string url) => Uri.UnescapeDataString(url).Split('#')[0].TrimEnd('/').Replace(' ', '_');
        var requested = requestedUrls.Select(Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var pinned = identities.FirstOrDefault(identity => new[] { identity.WikipediaUrl, identity.FandomUrl }.Any(url => url is not null && requested.Contains(Key(url))));
        if (pinned is not null) return pinned;
        foreach (var url in requestedUrls)
            if (PersonaKnowledgeSources.IdentityFromUrl(url, typedAlias.Length > 0 ? typedAlias : query, subjectType) is { } fromUrl) return fromUrl;
        var best = identities.FirstOrDefault();
        return best is not null && best.NameScore >= 0.75 && (best.SubjectType == subjectType || best.SubjectType == "unknown") ? best : null;
    }

    private static async Task<AgentResponse> DraftPersonaAsync(AgentRequest request)
    {
        var subject = RequiredBoundedString(request, "subject", 240);
        var subjectType = OptionalString(request, "subjectType")?.Equals("character", StringComparison.OrdinalIgnoreCase) == true ? "character" : "person";
        var description = OptionalString(request, "description")?.Trim() ?? string.Empty;
        if (description.Length > 600) description = description[..600];
        var sources = request.Params is { } requestParams && requestParams.TryGetProperty("sources", out var sourceJson) && sourceJson.ValueKind == JsonValueKind.Array
            ? (sourceJson.Deserialize<List<SavedPersonaSource>>(JsonOptions) ?? []).Take(32).ToList()
            : [];
        foreach (var source in sources) if (source.Excerpt.Length > 8_000) source.Excerpt = source.Excerpt[..8_000];
        if (sources.Count == 0) throw new InvalidOperationException("Select at least one researched source before drafting a profile.");
        var settings = CreateSettingsStore().Load();
        var endpoint = OptionalString(request, "endpoint") is { Length: > 0 } requestedEndpoint ? requestedEndpoint : settings.Endpoint;
        var model = OptionalString(request, "model") is { Length: > 0 } requestedModel ? requestedModel : settings.Model;
        var provider = OptionalString(request, "provider") is { Length: > 0 } requestedProvider ? requestedProvider : settings.ModelProvider;

        var voiceCard = PersonaProfileDrafting.BuildVoiceCard(subject, sources);
        var fields = new Dictionary<string, string>(StringComparer.Ordinal);
        var failures = new List<string>();
        foreach (var pass in PersonaProfileDrafting.BuildPasses(subject, subjectType, description, sources, voiceCard))
        {
            using var schema = JsonDocument.Parse(pass.Schema);
            var parameters = JsonSerializer.SerializeToElement(new
            {
                endpoint, model, provider,
                timeoutSeconds = 180,
                maxTokens = 800,
                temperature = 0.4,
                responseMode = ChatResponseModes.Think,
                responseSchema = schema.RootElement,
                suppressProgressiveResearch = true,
                suppressPersonaContinuity = true,
                messages = new[] { new ChatMessage("system", pass.SystemPrompt), new ChatMessage("user", pass.UserPrompt) },
            }, JsonOptions);
            var response = await CompleteChatAsync(new AgentRequest(ProtocolVersion, $"{request.Id}-{pass.Name}", "chat.complete", parameters)).ConfigureAwait(false);
            var content = response.Result is null ? null : JsonSerializer.SerializeToElement(response.Result, JsonOptions) is var result && result.TryGetProperty("content", out var text) && text.ValueKind == JsonValueKind.String ? text.GetString() : null;
            // A structured response can be empty when a local model spends its budget or
            // struggles with a large evidence window. Retry that pass once with bounded evidence.
            var coerced = response.Ok && content is not null
                ? PersonaProfileDrafting.CoerceFields(content, pass.Fields)
                : pass.Fields.ToDictionary(field => field, _ => string.Empty, StringComparer.Ordinal);
            if (coerced.Values.All(string.IsNullOrWhiteSpace))
            {
                var retryPass = PersonaProfileDrafting.BuildCompactRetry(pass);
                using var retrySchema = JsonDocument.Parse(retryPass.Schema);
                var retryParameters = JsonSerializer.SerializeToElement(new
                {
                    endpoint, model, provider,
                    timeoutSeconds = 180,
                    maxTokens = 1_600,
                    temperature = 0.2,
                    responseMode = ChatResponseModes.Think,
                    responseSchema = retrySchema.RootElement,
                    suppressProgressiveResearch = true,
                    suppressPersonaContinuity = true,
                    messages = new[] { new ChatMessage("system", retryPass.SystemPrompt), new ChatMessage("user", retryPass.UserPrompt) },
                }, JsonOptions);
                var retry = await CompleteChatAsync(new AgentRequest(ProtocolVersion, $"{request.Id}-{retryPass.Name}", "chat.complete", retryParameters)).ConfigureAwait(false);
                var retryContent = retry.Result is null ? null : JsonSerializer.SerializeToElement(retry.Result, JsonOptions) is var retryResult && retryResult.TryGetProperty("content", out var retryText) && retryText.ValueKind == JsonValueKind.String ? retryText.GetString() : null;
                if (retry.Ok && retryContent is not null)
                    coerced = PersonaProfileDrafting.CoerceFields(retryContent, pass.Fields);
                if (coerced.Values.All(string.IsNullOrWhiteSpace))
                    failures.Add($"{pass.Name}: compact retry returned no usable fields ({response.Error?.Message ?? "invalid or empty structured reply"})");
            }
            foreach (var (key, value) in coerced) fields[key] = value;
        }
        if (voiceCard.IsUsable)
            fields["speechPatterns"] = string.Join("\n\n", new[] { fields.GetValueOrDefault("speechPatterns"), voiceCard.Summary }.Where(part => !string.IsNullOrWhiteSpace(part)));
        return new(ProtocolVersion, request.Id, true, new
        {
            draft = fields,
            voiceCard = new { turnCount = voiceCard.TurnCount, summary = voiceCard.Summary, examples = voiceCard.Examples.Select(example => new { text = example.Text, sourceUrl = example.SourceUrl }) },
            failures,
        });
    }

    private static async Task<AgentResponse> ForcePersonaResearchAsync(AgentRequest request)
    {
        var personaId = RequiredBoundedString(request, "personaId", 128);
        var focus = OptionalString(request, "focus")?.Trim() ?? string.Empty;
        if (focus.Length > 240 || focus.Any(char.IsControl)) throw new InvalidOperationException("Research focus exceeds the safety limit.");
        var store = CreateSettingsStore();
        var settings = store.Load();
        var persona = settings.SavedPersonas.SingleOrDefault(item => item.Id == personaId) ?? throw new KeyNotFoundException("The persona does not exist.");
        if (persona.SourceMode != "public-research") throw new InvalidOperationException("Force more research is only available for public-research personas.");
        if (persona.Sources.Count >= 32) throw new InvalidOperationException("This persona has reached its 32-source limit. Remove a source before researching more.");

        var researchRequest = new AgentRequest(ProtocolVersion, request.Id + "-search", "persona.research", JsonSerializer.SerializeToElement(new
        {
            query = persona.Name,
            subjectType = persona.SubjectType,
            notes = string.IsNullOrWhiteSpace(focus) ? "Find additional independent biography, attributed dialogue or interviews, and useful topic-specific evidence" : focus,
            cutoffDate = PersonaKnowledgeCutoffPolicy.EffectiveCutoff(persona)?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? persona.KnowledgeCutoffDate,
            sourceUrls = Array.Empty<string>(),
        }, JsonOptions));
        var researchResponse = await ResearchPersonaAsync(researchRequest).ConfigureAwait(false);
        if (!researchResponse.Ok || researchResponse.Result is null) throw new InvalidOperationException(researchResponse.Error?.Message ?? "No additional research could be completed.");
        var researchJson = JsonSerializer.SerializeToElement(researchResponse.Result, JsonOptions);
        if (!researchJson.TryGetProperty("sources", out var sourceJson)) throw new InvalidOperationException("Research returned no usable source list.");
        var found = sourceJson.Deserialize<List<SavedPersonaSource>>(JsonOptions) ?? [];
        var remaining = 32 - persona.Sources.Count;
        var newSources = found
            .Where(source => persona.Sources.All(existing => !existing.Url.Equals(source.Url, StringComparison.OrdinalIgnoreCase)))
            .Where(source => !persona.ExcludedResearchUrls.Contains(source.Url, StringComparer.OrdinalIgnoreCase))
            .Where(source => source.SpeakerAttribution == "subject-attributed"
                || source.Type is "Biography" or "Canon reference" or "Official source" or "Character analysis" or "Other reference")
            .Take(Math.Min(8, remaining))
            .ToList();
        persona.Sources.AddRange(newSources);
        var effectiveFocus = string.IsNullOrWhiteSpace(focus) ? "additional public evidence" : focus;
        SavedPersonaDistillation? distillation = null;
        if (newSources.Count > 0)
        {
            distillation = await DistillPersonaEvidenceAsync(persona, effectiveFocus).ConfigureAwait(false);
            if (distillation is not null) persona.LatestDistillation = distillation;
        }
        persona.ResearchPassCount++;
        persona.LastResearchAtUtc = DateTimeOffset.UtcNow;
        persona.LastResearchSummary = newSources.Count == 0
            ? "The search found no new sources that passed the persona's relevance and evidence filters."
            : $"Added {newSources.Count} screened source{(newSources.Count == 1 ? "" : "s")}{(distillation is null ? "; profile synthesis could not be refreshed with the configured model." : " and refreshed the evidence-backed profile synthesis.")}";
        persona.ResearchHistory.Insert(0, new SavedPersonaResearchPass { Focus = effectiveFocus, SourcesAdded = newSources.Count, Summary = persona.LastResearchSummary });
        persona.ResearchHistory = persona.ResearchHistory.Take(12).ToList();
        persona.UpdatedAtUtc = DateTimeOffset.UtcNow;
        store.Save(settings);
        return new(ProtocolVersion, request.Id, true, new { persona = PersonaResponse(persona), sourcesAdded = newSources.Count, synthesisUpdated = distillation is not null, summary = persona.LastResearchSummary });
    }

    private static async Task<AgentResponse> ResearchPersonaAsync(AgentRequest request)
    {
        var query = RequiredBoundedString(request, "query", 240);
        var subjectType = OptionalString(request, "subjectType")?.Equals("character", StringComparison.OrdinalIgnoreCase) == true ? "character" : "person";
        var notes = OptionalString(request, "notes") ?? string.Empty;
        var cutoffText = OptionalString(request, "cutoffDate");
        var cutoff = PersonaKnowledgeCutoffPolicy.ParseDate(cutoffText);
        if (notes.Length > 600 || notes.Any(char.IsControl)) throw new InvalidOperationException("Research notes exceed the safety limit.");
        var search = new WebSearchProvider();
        var requestedUrls = OptionalStringList(request, "sourceUrls", 64, 2_000)
            .Select(WebSearchProvider.NormalizePublicResearchUrl)
            .Where(url => url is not null)
            .Cast<string>()
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        // Resolve the subject and gather structured evidence first: canon/biography text, wiki
        // personality and quote sections, speaker-labelled transcripts, and Wikiquote.
        var knowledge = new PersonaKnowledgeSources();
        using var knowledgeTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        var identity = await ResolveResearchIdentityAsync(knowledge, query, notes, subjectType, requestedUrls, knowledgeTimeout.Token).ConfigureAwait(false);
        if (identity is not null) identity = await knowledge.AddLifeDatesAsync(identity, knowledgeTimeout.Token).ConfigureAwait(false);
        var knowledgeSources = identity is null ? [] : (await knowledge.GatherAsync(identity, knowledgeTimeout.Token).ConfigureAwait(false))
            .Select(document => new SavedPersonaSource
            {
                Title = document.Title,
                Url = document.Url,
                AuthorOrPublisher = document.Publisher,
                Type = document.Kind,
                SpeakerAttribution = document.SpeakerAttribution,
                AttributedTurnCount = document.AttributedTurnCount,
                EvidenceQuality = document.EvidenceQuality,
                ReliabilityNote = document.ReliabilityNote,
                PublishedDate = string.Empty,
                Excerpt = document.Text[..Math.Min(document.Text.Length, 8_000)],
            }).ToList();
        var subjectNames = (identity is null ? new[] { query } : PersonaKnowledgeSources.SpeakerLabels(identity).Append(query))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        bool NamesSubject(string text) => subjectNames.Any(name => ContainsPersonaName(name, text));
        string CoveredKey(string url) => url.Split('#')[0].TrimEnd('/');
        var coveredUrls = knowledgeSources.Select(source => CoveredKey(source.Url))
            .Concat(new[] { identity?.WikipediaUrl, identity?.FandomUrl }.Where(url => url is not null).Select(url => CoveredKey(url!)))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        // Characters are covered by canon wikis and transcripts; web lanes add little but noise and
        // a long wait. Real people still need the web for interviews, podcasts, and captions.
        var runWebLanes = subjectType != "character" || knowledgeSources.Count < 3;
        var lanes = !runWebLanes ? Array.Empty<(string Category, string Terms)>() : subjectType == "character"
            ? new[]
            {
                (Category: "Canon reference", Terms: "fictional character official canon profile franchise"),
                (Category: "Character dialogue", Terms: "character dialogue transcript screenplay subtitles"),
                (Category: "Story transcript", Terms: "movie film full transcript script subtitles"),
                (Category: "Character analysis", Terms: "character history personality motivations story arc analysis"),
                (Category: "Official source", Terms: "official character biography studio franchise"),
                (Category: "Other reference", Terms: "character lore wiki reference guide"),
            }
            : new[]
            {
                (Category: "Biography", Terms: "official biography profile career education"),
                (Category: "Conversation transcript", Terms: "podcast conversation transcript full episode"),
                (Category: "Interview", Terms: "long form interview Q&A conversation with"),
                (Category: "Video captions", Terms: "YouTube interview podcast video captions transcript"),
                (Category: "Conversation transcript", Terms: "public speech debate Q&A transcript conversation"),
                (Category: "Other reference", Terms: "official site public statements career profile"),
            };
        // Persona research fans out across biography, dialogue, transcript, and
        // canon lanes. Give the paced batches enough time to return transcript
        // candidates; a short global timeout often left only a user-pinned URL
        // and made name-only research look complete while missing speech.
        using var searchTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        // Search providers throttle bursts; a request per query variant across all
        // evidence lanes used to fan out twelve simultaneous requests and often
        // return only the explicitly selected URL. Keep research broad, but paced.
        using var searchLimit = new SemaphoreSlim(3, 3);
        var subjectName = identity?.CanonicalName ?? PersonaNameWithoutHonorifics(query);
        var searches = await Task.WhenAll(lanes.Select(async lane =>
        {
            try
            {
                var queryVariants = new[]
                {
                    $"\"{subjectName}\" {lane.Terms}",
                    $"{subjectName} {notes} {lane.Terms}",
                }.Distinct(StringComparer.OrdinalIgnoreCase);
                var batches = await Task.WhenAll(queryVariants.Select(async variant =>
                {
                    await searchLimit.WaitAsync(searchTimeout.Token).ConfigureAwait(false);
                    try { return await search.SearchAsync(variant, searchTimeout.Token).ConfigureAwait(false); }
                    finally { searchLimit.Release(); }
                })).ConfigureAwait(false);
                return (lane.Category, Results: (IReadOnlyList<WebSearchResult>)batches.SelectMany(batch => batch).GroupBy(result => result.Url, StringComparer.OrdinalIgnoreCase).Select(group => group.First()).ToArray());
            }
            catch { return (lane.Category, Results: (IReadOnlyList<WebSearchResult>)Array.Empty<WebSearchResult>()); }
        })).ConfigureAwait(false);
        var searchCandidates = searches.SelectMany(batch => batch.Results.Take(6).Select(result => (batch.Category, Result: result)))
            .Where(item => !coveredUrls.Contains(CoveredKey(item.Result.Url)))
            .Where(item => NamesSubject($"{item.Result.Title} {item.Result.Snippet}") || ContainsPersonaClue(notes, $"{item.Result.Title} {item.Result.Snippet}"))
            .GroupBy(item => item.Result.Url, StringComparer.OrdinalIgnoreCase).Select(group => group.First()).ToList();
        var candidates = requestedUrls.Where(url => !coveredUrls.Contains(CoveredKey(url))).Take(16).Select(url => (Category: "User-selected source", Result: new WebSearchResult(url, url, string.Empty)))
            .Concat(searchCandidates.Where(item => requestedUrls.All(url => !url.Equals(item.Result.Url, StringComparison.OrdinalIgnoreCase))))
            .Take(32).ToList();
        using var fetchTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(42));
        using var fetchLimit = new SemaphoreSlim(10, 10);
        var fetchWarnings = new System.Collections.Concurrent.ConcurrentBag<string>();
        var loaded = await Task.WhenAll(candidates.Select(async item =>
        {
            await fetchLimit.WaitAsync(fetchTimeout.Token).ConfigureAwait(false);
            try
            {
                WebPageText? page = null;
                try { page = await search.FetchTextAsync(item.Result.Url, fetchTimeout.Token).ConfigureAwait(false); }
                catch (Exception error)
                {
                    if (requestedUrls.Contains(item.Result.Url, StringComparer.OrdinalIgnoreCase))
                    {
                        var failedHost = Uri.TryCreate(item.Result.Url, UriKind.Absolute, out var failedUri) ? failedUri.Host : "Selected source";
                        fetchWarnings.Add($"{failedHost}: fetch failed ({error.GetType().Name}).");
                        return null;
                    }
                }
                if (page is null && requestedUrls.Contains(item.Result.Url, StringComparer.OrdinalIgnoreCase))
                    fetchWarnings.Add($"{new Uri(item.Result.Url).Host}: no readable text was available from this selected source.");
                if (PersonaKnowledgeCutoffPolicy.IsPublishedAfterCutoff(page?.PublishedDate, cutoff))
                    return null;
                var title = page?.Title ?? item.Result.Title;
                var pageText = page?.Text ?? item.Result.Snippet;
                if (!NamesSubject($"{title} {pageText}"))
                {
                    if (requestedUrls.Contains(item.Result.Url, StringComparer.OrdinalIgnoreCase)) fetchWarnings.Add($"{new Uri(item.Result.Url).Host}: the page did not contain evidence matching {query}.");
                    return null;
                }
                if (LooksLikeTranscriptShell(item.Result.Url, pageText))
                {
                    if (requestedUrls.Contains(item.Result.Url, StringComparer.OrdinalIgnoreCase)) fetchWarnings.Add($"{new Uri(item.Result.Url).Host}: the page was only a transcript-app shell, with no extractable transcript.");
                    return null;
                }
                IReadOnlyList<string> researchSpeakerLabels = identity is null ? new[] { query } : subjectNames;
                if (subjectType == "person")
                    researchSpeakerLabels = PersonaDialogueEvidence.AddConfirmedFirstNameAlias(identity?.CanonicalName ?? subjectName, researchSpeakerLabels, pageText);
                var detectedAttribution = PersonaDialogueEvidence.DetectSpeaker(researchSpeakerLabels, pageText);
                var speakerAttribution = page?.SpeakerAttribution is { } knownAttribution and not "unknown"
                    ? knownAttribution
                    : detectedAttribution.IsUsable ? "subject-attributed" : "unattributed-or-unknown";
                var attributedTurns = page?.AttributedTurnCount > 0 ? page.AttributedTurnCount : detectedAttribution.TurnCount;
                var category = page?.SourceType ?? CategorizePersonaSource(subjectType, item.Category, title, item.Result.Url, pageText);
                if (category == "Other reference" && speakerAttribution == "subject-attributed" && PersonaDialogueEvidence.HasTranscriptStructure(pageText))
                    category = subjectType == "character" ? "Story transcript" : "Interview";
                if (category.Contains("transcript", StringComparison.OrdinalIgnoreCase) && !PersonaDialogueEvidence.HasTranscriptStructure(pageText)) category = "Other reference";
                if (category == "Conversation transcript" && speakerAttribution != "subject-attributed") category = "Unattributed conversation transcript";
                if (category == "Interview" && speakerAttribution != "subject-attributed") category = "Unattributed interview";
                var containsDialogue = category.Contains("transcript", StringComparison.OrdinalIgnoreCase)
                    || category.Contains("interview", StringComparison.OrdinalIgnoreCase)
                    || category.Contains("dialogue", StringComparison.OrdinalIgnoreCase)
                    || category.Contains("caption", StringComparison.OrdinalIgnoreCase);
                if (!containsDialogue) { speakerAttribution = "not-applicable"; attributedTurns = 0; }
                var excerpt = speakerAttribution == "subject-attributed"
                    ? PersonaDialogueEvidence.SelectSpeakerTurns(researchSpeakerLabels, pageText)
                    : SelectPersonaEvidenceExcerpt(subjectName, notes, title, pageText);
                if (excerpt.Length < 120 && page?.SpeakerAttribution == "unattributed-mixed-speakers")
                    excerpt = SelectMixedTranscriptSample(pageText);
                // Do not count a matching title or a failed-fetch search snippet
                // as researched evidence. The match remains visible in discovery,
                // while the evidence set contains only pages with usable content.
                if (excerpt.Length < 120)
                {
                    if (requestedUrls.Contains(item.Result.Url, StringComparer.OrdinalIgnoreCase))
                        fetchWarnings.Add($"{new Uri(item.Result.Url).Host}: fetched text had no substantial subject-matched excerpt (type {page?.SourceType ?? "general page"}; speaker status {page?.SpeakerAttribution ?? "unknown"}).");
                    return null;
                }
                var reputable = IsReputablePublicSource(item.Result.Url);
                return new SavedPersonaSource
                {
                    Title = title,
                    Url = item.Result.Url,
                    AuthorOrPublisher = Uri.TryCreate(item.Result.Url, UriKind.Absolute, out var sourceUri) ? sourceUri.Host : string.Empty,
                    Type = category,
                    SpeakerAttribution = speakerAttribution,
                    AttributedTurnCount = attributedTurns,
                    EvidenceQuality = page?.EvidenceQuality is { } quality and not "unreviewed" ? quality : speakerAttribution == "subject-attributed" ? "explicit-speaker-labels" : category.Contains("transcript", StringComparison.OrdinalIgnoreCase) || category.Contains("caption", StringComparison.OrdinalIgnoreCase) || category.Contains("interview", StringComparison.OrdinalIgnoreCase) ? "dialogue-present-speaker-unverified" : "reference-text",
                    ReliabilityNote = category.StartsWith("Unattributed", StringComparison.Ordinal) ? "Dialogue text is present, but the source does not identify which lines belong to this person. It is excluded from voice and mannerism evidence." : reputable ? "Official, educational, or established editorial source; check the linked evidence." : category.Contains("transcript", StringComparison.OrdinalIgnoreCase) ? "Third-party transcript with explicit speaker labels; compare against linked audio or video for errors." : "Public-source lead; confirm the identity and details before relying on it.",
                    PublishedDate = page?.PublishedDate ?? string.Empty,
                    Excerpt = excerpt[..Math.Min(excerpt.Length, 8_000)],
                };
            }
            finally { fetchLimit.Release(); }
        })).ConfigureAwait(false);
        var sources = knowledgeSources.Concat(loaded.Where(source => source is not null).Cast<SavedPersonaSource>()).Take(32).ToList();
        if (sources.Count == 0)
            fetchWarnings.Add("No usable research sources were found. Public search may be unavailable, or the matching pages may block text extraction; retry or add a known source URL.");
        var reputableCount = sources.Count(source => IsReputablePublicSource(source.Url));
        var qualified = subjectType == "character"
            ? sources.Any(source => source.Type is "Canon reference" or "Official source") || sources.Count >= 2
            : sources.Count >= 2 && reputableCount >= 1;
        var categoryCounts = new
        {
            biographies = sources.Count(source => source.Type == "Biography"),
            conversationTranscripts = sources.Count(source => source.Type == "Conversation transcript" && source.SpeakerAttribution == "subject-attributed"),
            unattributedConversationTranscripts = sources.Count(source => source.Type == "Unattributed conversation transcript" || source.Type == "Unattributed interview" || source.Type == "Unattributed video captions"),
            interviews = sources.Count(source => source.Type == "Interview" && source.SpeakerAttribution == "subject-attributed"),
            videoCaptions = sources.Count(source => source.Type == "Video captions" && source.SpeakerAttribution == "subject-attributed"),
            videoReferences = sources.Count(source => source.Type == "Video reference"),
            otherReferences = sources.Count(source => source.Type == "Other reference"),
            canonReferences = sources.Count(source => source.Type is "Canon reference" or "Official source"),
            characterDialogues = sources.Count(source => source.Type is "Character dialogue" or "Story transcript"),
            characterAnalysis = sources.Count(source => source.Type == "Character analysis"),
            total = sources.Count,
        };
        return new(ProtocolVersion, request.Id, true, new
        {
            query,
            subjectType,
            requestedSourceCount = requestedUrls.Length,
            identity = identity is null ? null : new
            {
                canonicalName = identity.CanonicalName,
                description = identity.Description,
                subjectType = identity.SubjectType,
                franchise = identity.Franchise,
                aliases = identity.Aliases,
                primaryUrl = identity.PrimaryUrl,
                sources = identity.SourceSummary,
                birthDate = identity.BirthDate,
                deathDate = identity.DeathDate,
            },
            candidateCount = candidates.Count,
            publicFigureQualified = qualified,
            qualification = qualified
                ? subjectType == "character"
                    ? "Character research found canon or reference material. Dialogue and story sources are counted separately; review the evidence and gaps before building the profile."
                    : "Research searched biographies, long-form conversations, interviews, video captions, and public appearances. Review the evidence and gaps before building the profile."
                : subjectType == "character"
                    ? "The research found too little canon or reference material to confirm this character. Add a franchise clue or a known source and search again."
                    : "The research returned too little trusted coverage to confirm this person. Review every source before saving or add a known official source.",
            fetchWarnings = fetchWarnings.Distinct(StringComparer.OrdinalIgnoreCase).Take(12).ToArray(),
            categoryCounts,
            sources,
        });
    }


}
