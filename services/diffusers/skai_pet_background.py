"""Remove a companion frame's background with the user's local U2Net model."""
import base64
import io
import json
import sys


def main(request):
    try:
        from PIL import Image
        from rembg import new_session, remove

        encoded = request.get("image")
        if not isinstance(encoded, str) or len(encoded) > 8_400_000:
            raise ValueError("Choose a PNG or JPEG frame up to 6 MB.")
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 6 * 1024 * 1024:
            raise ValueError("Choose a frame up to 6 MB.")
        image = Image.open(io.BytesIO(raw))
        if image.format not in ("PNG", "JPEG"):
            raise ValueError("Choose a PNG or JPEG frame.")
        if image.width > 2048 or image.height > 2048:
            raise ValueError("Pet frames must be 2,048 pixels or smaller in each direction.")
        image = image.convert("RGBA")
        session = new_session("u2net")
        result = remove(image, session=session)
        output = io.BytesIO()
        result.save(output, format="PNG", optimize=True)
        data = output.getvalue()
        if len(data) > 5 * 1024 * 1024:
            raise ValueError("The transparent frame exceeds Skai's 5 MB limit.")
        print(json.dumps({"type": "result", "mediaType": "image/png", "data": base64.b64encode(data).decode("ascii")}), flush=True)
        print(json.dumps({"type": "done"}), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"type": "error", "message": str(error)}), flush=True)
        return 1


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.readline())
        if not isinstance(request, dict):
            raise ValueError("A frame image is required.")
        sys.exit(main(request))
    except Exception as error:
        print(json.dumps({"type": "error", "message": str(error)}), flush=True)
        sys.exit(1)
