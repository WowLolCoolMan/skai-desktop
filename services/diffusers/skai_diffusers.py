"""Skai's optional local Diffusers worker. One JSON request in, one result JSON out."""
import base64
import io
import json
import sys
import traceback


def main(request):
    try:
        import torch
        from diffusers import AutoPipelineForImage2Image, AutoPipelineForText2Image

        model_id = request.get("model", "stabilityai/sd-turbo")
        if model_id != "stabilityai/sd-turbo":
            raise ValueError("This built-in workflow currently supports stabilityai/sd-turbo only.")
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        options = {"torch_dtype": dtype}
        if device == "cuda":
            options["variant"] = "fp16"
        source_data = request.get("sourceImage")
        if source_data is not None:
            from PIL import Image
            raw = base64.b64decode(source_data, validate=True)
            if len(raw) > 6 * 1024 * 1024:
                raise ValueError("The source image exceeds Skai's 6 MB limit.")
            source = Image.open(io.BytesIO(raw)).convert("RGB")
            source.thumbnail((512, 512))
            width = max(64, source.width - source.width % 8)
            height = max(64, source.height - source.height % 8)
            source = source.resize((width, height))
            pipe = AutoPipelineForImage2Image.from_pretrained(model_id, **options)
        else:
            source = None
            pipe = AutoPipelineForText2Image.from_pretrained(model_id, **options)
        pipe.to(device)
        arguments = {"prompt": request["prompt"], "num_inference_steps": 4, "guidance_scale": 0.0}
        if source is not None:
            arguments.update({"image": source, "strength": 0.55})
        else:
            arguments.update({"height": 512, "width": 512})
        def report_step(_pipeline, step, _timestep, callback_kwargs):
            # Some schedulers expand or collapse the requested step count. Report
            # the actual active schedule so the UI never promises phantom steps.
            total_steps = (
                getattr(_pipeline, "_num_timesteps", None)
                or len(getattr(_pipeline.scheduler, "timesteps", []))
                or arguments["num_inference_steps"]
            )
            print(json.dumps({"type": "progress", "step": step + 1, "total": total_steps}), flush=True)
            return callback_kwargs

        result = pipe(**arguments, callback_on_step_end=report_step)
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
        if request.get("sourceImage") is not None and (not isinstance(request["sourceImage"], str) or len(request["sourceImage"]) > 8_400_000 or request.get("sourceImageMediaType") not in ("image/png", "image/jpeg")):
            raise ValueError("Choose a valid PNG or JPEG source image up to 6 MB.")
        sys.exit(main(request))
    except Exception as error:
        print(json.dumps({"type": "error", "message": str(error)}), flush=True)
        sys.exit(1)
