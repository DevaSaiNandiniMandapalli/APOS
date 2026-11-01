import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSION_LIMITS } from "./conversion-engine";
import { convertImageFile } from "./image-convert";

type Format = "png" | "jpeg" | "webp";

function imageBytes(format: Format, width: number, height: number): Uint8Array {
  if (format === "png") {
    return new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
      (width >>> 24) & 255, (width >>> 16) & 255,
      (width >>> 8) & 255, width & 255,
      (height >>> 24) & 255, (height >>> 16) & 255,
      (height >>> 8) & 255, height & 255,
    ]);
  }

  if (format === "jpeg") {
    return new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08,
      (height >>> 8) & 255, height & 255,
      (width >>> 8) & 255, width & 255, 0x03,
    ]);
  }

  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes.set([0, 0, 0, 10], 16);
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 255;
  bytes[25] = (w >>> 8) & 255;
  bytes[26] = (w >>> 16) & 255;
  bytes[27] = h & 255;
  bytes[28] = (h >>> 8) & 255;
  bytes[29] = (h >>> 16) & 255;
  return bytes;
}

function makeBlob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type });
}

function makeFile(format: Format, width = 10, height = 20) {
  const bytes = imageBytes(format, width, height);
  return {
    name: `sample.${format}`,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
  };
}

describe("image conversion engine", () => {
  const context = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };

  const bitmap = {
    width: 10,
    height: 20,
    close: vi.fn(),
  };

  let canvas: HTMLCanvasElement;
  let currentOutputFormat: Format = "png";

  beforeEach(() => {
    vi.clearAllMocks();
    bitmap.width = 10;
    bitmap.height = 20;

    const canvasMock = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback, mimeType?: string) => {
        const format = currentOutputFormat;
        const blob = makeBlob(
          imageBytes(format, canvasMock.width, canvasMock.height),
          mimeType ?? "",
        );
        callback(blob);
      }),
    };

    canvas = canvasMock as unknown as HTMLCanvasElement;

    vi.stubGlobal("document", {
      createElement: vi.fn(() => canvas),
    });

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap as unknown as ImageBitmap),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["png", "jpeg"],
    ["png", "webp"],
    ["jpeg", "png"],
    ["jpeg", "webp"],
    ["webp", "png"],
    ["webp", "jpeg"],
  ] as const)("converts %s to %s", async (input, output) => {
    currentOutputFormat = output;

    const progress = vi.fn();

    const result = await convertImageFile(
      makeFile(input),
      output,
      {},
      new AbortController().signal,
      progress,
    );

    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(progress).toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("resizes while preserving aspect ratio", async () => {
    currentOutputFormat = "png";

    await convertImageFile(
      makeFile("png"),
      "png",
      { width: 5 },
      new AbortController().signal,
      vi.fn(),
    );

    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      5,
      10,
    );
  });
  it("does not upscale images beyond their original dimensions", async () => {
    currentOutputFormat = "png";

    await convertImageFile(
      makeFile("png", 10, 20),
      "png",
      { width: 100, height: 100 },
      new AbortController().signal,
      vi.fn(),
    );

    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      10,
      20,
    );
  });

  it("paints a white background before drawing JPEG output", async () => {
    currentOutputFormat = "jpeg";

    await convertImageFile(
      makeFile("png"),
      "jpeg",
      {},
      new AbortController().signal,
      vi.fn(),
    );

    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 10, 20);
    expect(context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      context.drawImage.mock.invocationCallOrder[0],
    );
  });

  it("rejects unsupported TIFF input", async () => {
    const bytes = new Uint8Array([0x49, 0x49, 0x2a, 0]);

    const file = {
      name: "sample.tiff",
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer as ArrayBuffer,
    };

    await expect(
      convertImageFile(
        file,
        "png",
        {},
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow("Only PNG, JPEG and WebP images are supported.");
  });

  it("rejects an oversized input before reading it", async () => {
    const arrayBuffer = vi.fn();

    const file = {
      name: "large.png",
      size: CONVERSION_LIMITS.inputFileBytes + 1,
      arrayBuffer,
    };

    await expect(
      convertImageFile(
        file,
        "png",
        {},
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow("maximum input file size");

    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects invalid requested dimensions", async () => {
    await expect(
      convertImageFile(
        makeFile("png"),
        "png",
        { width: -10 },
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow("requested image width is invalid");

    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("rejects excessive pixel dimensions", async () => {
    await expect(
      convertImageFile(
        makeFile("png", 8000, 6000),
        "png",
        {},
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow("dimensions exceed the supported limits");
  });

  it("rejects a pre-cancelled operation", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      convertImageFile(
        makeFile("png"),
        "png",
        {},
        controller.signal,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects an invalid input signature", async () => {
    const bytes = new TextEncoder().encode("not an image");

    const file = {
      name: "fake.png",
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer as ArrayBuffer,
    };

    await expect(
      convertImageFile(
        file,
        "png",
        {},
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow("Only PNG, JPEG and WebP images are supported.");
  });

  it("rejects a null canvas output", async () => {
    currentOutputFormat = "png";

    vi.mocked(canvas.toBlob).mockImplementationOnce((callback) => {
      callback(null);
    });

    await expect(
      convertImageFile(
        makeFile("png"),
        "png",
        {},
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow("could not encode the image");

    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
