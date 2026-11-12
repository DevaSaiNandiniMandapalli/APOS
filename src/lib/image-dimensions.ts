export type ImageInfo = {
  url: string;
  width: number;
  height: number;
};

export async function inspectImageFile(file: File): Promise<ImageInfo> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { url, width: image.naturalWidth, height: image.naturalHeight };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
