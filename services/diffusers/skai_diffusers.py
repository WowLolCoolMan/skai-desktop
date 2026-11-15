"""Skai's optional local Diffusers worker. One JSON request in, one result JSON out."""
import base64
import io
import json
import sys
import traceback


def main(request):
    try:
        import torch
        from diffusers import AutoPipelineForText2Image

        model_id = request.get("model", "stabilityai/sd-turbo")
        if model_id != "stabilityai/sd-turbo":
            raise ValueError("This built-in workflow currently supports stabilityai/sd-turbo only.")
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        options = {"torch_dtype": dtype}
        if device == "cuda":
            options["variant"] = "fp16"
        pipe = AutoPipelineForText2Image.from_pretrained(model_id, **options)
        pipe.to(device)
        result = pipe(
            prompt=request["prompt"],
            num_inference_steps=4,
            guidance_scale=0.0,
            height=512,
            width=512,
        )
        image = result.images[0]
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=88, optimize=True)
        payload = output.getvalue()
        if len(payload) > 5 * 1024 * 1024:
            raise ValueError("The generated image exceeded Skai's 5 MB transfer limit.")
        print(json.dumps({"type": "result", "mediaType": "image/jpeg", "data": base64.b64encode(payload).decode("ascii"), "width": image.width, "height": image.height}), flush=True)
        print(json.dumps({"type": "done"}), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"type": "error", "message": f"{error}\n{traceback.format_exc(limit=2)}"}), flush=True)
        return 1


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.readline())
        if not isinstance(request, dict) or not isinstance(request.get("prompt"), str):
            raise ValueError("An image prompt is required.")
        if len(request["prompt"]) > 8000:
            raise ValueError("The image prompt exceeds 8,000 characters.")
        sys.exit(main(request))
    except Exception as error:
        print(json.dumps({"type": "error", "message": str(error)}), flush=True)
        sys.exit(1)
