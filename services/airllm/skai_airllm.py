"""Skai's built-in AirLLM worker.

One JSON request is read from stdin and JSON events are written to stdout.
The worker is intentionally stateless per process; Skai serializes requests so
model memory is reclaimed when a response is complete or canceled.
"""
import json
import sys
import traceback
import contextlib
import io


def emit(payload):
    # Keep the JSON-lines protocol ASCII-safe on Windows PowerShell and default
    # console code pages; JSON decoding restores the original Unicode text.
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def main(request):
    try:
        from airllm import AutoModel
        import torch

        requested_device = request.get("device", "auto")
        if requested_device == "auto":
            if torch.cuda.is_available():
                requested_device = "cuda:0"
            elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
                requested_device = "mps"
            else:
                requested_device = "cpu"
        if requested_device == "cuda" and torch.cuda.is_available():
            requested_device = "cuda:0"
        if requested_device.startswith("cuda") and not torch.cuda.is_available():
            raise RuntimeError("AirLLM was configured to use CUDA, but PyTorch reports no available CUDA device. Choose Auto or CPU, or install a compatible accelerator build of PyTorch.")
        if requested_device == "mps" and (getattr(torch.backends, "mps", None) is None or not torch.backends.mps.is_available()):
            raise RuntimeError("AirLLM was configured to use MPS, but PyTorch reports no available Apple Metal device. Choose Auto or CPU.")
        if requested_device == "cpu" and request.get("compression") in ("4bit", "8bit"):
            raise RuntimeError("AirLLM 4-bit and 8-bit compression requires a CUDA device. Choose Auto or CUDA, or disable compression for CPU inference.")

        # Custom repository code is a separate trust decision in Skai. The
        # host keeps this disabled unless the user explicitly approves it.
        # Older AirLLM releases reject the keyword when it is false. Omitting it
        # keeps the default safe behavior while remaining compatible with those
        # releases; only an explicit user approval adds the opt-in override.
        kwargs = {}
        kwargs["device"] = requested_device
        if request.get("allow_remote_code", False):
            kwargs["trust_remote_code"] = True
        if request.get("compression") in ("4bit", "8bit"):
            kwargs["compression"] = request["compression"]
        if request.get("cache_path"):
            kwargs["layer_shards_saving_path"] = request["cache_path"]
        if request.get("hf_token"):
            kwargs["hf_token"] = request["hf_token"]
        if request.get("delete_original"):
            kwargs["delete_original"] = True
        # AirLLM/Transformers emit progress text to stdout. Keep the worker's
        # stdout reserved for its line-delimited JSON protocol.
        with contextlib.redirect_stdout(io.StringIO()):
            model = AutoModel.from_pretrained(request["model"], **kwargs)
            messages = request.get("messages", [])
            tokenizer = model.tokenizer
            prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True) if hasattr(tokenizer, "apply_chat_template") else "\n".join(f"{m['role']}: {m['content']}" for m in messages)
            tokens = tokenizer([prompt], return_tensors="pt", return_attention_mask=False, truncation=True, max_length=8192, padding=False)
            output = model.generate(tokens["input_ids"].to(model.device), max_new_tokens=request.get("max_new_tokens", 1024), temperature=request.get("temperature", 0.7), use_cache=True, return_dict_in_generate=True)
            text = tokenizer.decode(output.sequences[0], skip_special_tokens=True)
        if text.startswith(prompt):
            text = text[len(prompt):]
        emit({"type": "text", "text": text.strip()})
        emit({"type": "done"})
    except Exception as exc:
        emit({"type": "error", "message": f"{exc}\n{traceback.format_exc(limit=2)}"})
        return 1
    return 0


if __name__ == "__main__":
    line = sys.stdin.readline()
    sys.exit(main(json.loads(line)))
