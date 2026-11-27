namespace SkaiDesktop.Core.Models;

/// <summary>Weight formats understood by Skai's local runtime adapters.</summary>
public enum ModelFormat
{
    Unknown,
    Gguf,
    SafeTensors,
    Onnx,
    PyTorch,
}

/// <summary>High-level work a local model is expected to perform.</summary>
public enum ModelTask
{
    Unknown,
    TextGeneration,
    VisionLanguage,
    Embeddings,
    TextToImage,
    TextToSpeech,
    Audio,
}

/// <summary>Honest routing metadata; it describes an adapter, not a claim that it is installed.</summary>
public sealed record ModelRuntimeRoute(
    ModelFormat Format,
    ModelTask Task,
    string Runtime,
    string Evidence);
