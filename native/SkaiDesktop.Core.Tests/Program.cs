// Core test runner. Each area lives in its own *Tests.cs file; they run in this order
// and the run stops at the first failed Check (see TestSupport.cs).

if (args.Length == 1 && args[0].Equals("--model-library", StringComparison.OrdinalIgnoreCase))
{
    await ModelLibraryTests.RunAsync();
    Console.WriteLine("Selected Model Library checks passed.");
    return;
}

await DiagnosticsTests.RunAsync();
ProductIdentityTests.Run();
VoiceModelTests.Run();
CatalogTests.Run();
await ProjectHealthTests.RunAsync();
await ModelLibraryTests.RunAsync();
LocalExecutionCapacityPolicyTests.Run();
ModelContextCompatibilityTests.Run();
await LocalRuntimeCapacityTests.RunAsync();
await ChatProviderTests.RunAsync();
DocumentsOnlyPromptTests.Run();
AirLlmProviderTests.Run();
await ImageGenerationTests.RunAsync();
await AttachmentTests.RunAsync();
await BoundedReadTests.RunAsync();
await ConversationArchiveTests.RunAsync();
ConversationForkTests.Run();
ConversationMessageSearchTests.Run();
PetWanderPlannerTests.Run();
await WebSearchTests.RunAsync();
await PersonaKnowledgeTests.RunAsync();
await GitHubTests.RunAsync();
await CloudVoiceCredentialTests.RunAsync();
ChatMessageTests.Run();
PromptVariableTests.Run();
OpenApiToolDiscoveryTests.Run();
await LocalStorageAndWorkspaceTests.RunAsync();
ExternalLinkTests.Run();
OperationJournalTests.Run();
OperationServiceTests.Run();
WorkflowServiceTests.Run();
WorkflowRunServiceTests.Run();
WorkflowApprovalTimingTests.Run();
WorkflowCapabilityGateTests.Run();
ReadOnlyWorkspaceAdapterTests.Run();
ChatMessageQueueTests.Run();
ChatMessageQueueStoreTests.Run();
ConversationSearchTests.Run();
ScheduledTaskTests.Run();
NavigationHistoryTests.Run();
ModelComparisonPolicyTests.Run();
ModelCouncilPolicyTests.Run();
SkillPackageInstallerTests.Run();
McpToolPermissionGateTests.Run();
await McpStdioClientTests.RunAsync();
McpConnectionRegistryTests.Run();
await McpStreamableHttpClientTests.RunAsync();
await ReleaseManifestVerifierTests.RunAsync();
ConversationContextPlannerTests.Run();
await SemanticConversationCompactorTests.RunAsync();
MemoryStoreTests.Run();
StatusMessageHistoryTests.Run();
MemoryPromptContextTests.Run();
await AgentTaskArtifactTests.RunAsync();
ProjectVerificationTests.Run();
StartupRecoveryTests.Run();

Console.WriteLine("Native core checks passed.");
