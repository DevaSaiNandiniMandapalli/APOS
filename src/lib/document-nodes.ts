import {
  $createParagraphNode,
  $createTextNode,
  type BaseSelection,
  type EditorConfig,
  ElementNode,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
  type SerializedElementNode,
} from "lexical";

export type HeadingTag = "h1" | "h2" | "h3";

export type SerializedHeadingNode = SerializedElementNode & {
  tag: HeadingTag;
};

export function $createHeadingNode(tag: HeadingTag): HeadingNode {
  return new HeadingNode(tag);
}

/**
 * Custom Lexical element node for headings. Lexical 0.20.x does not ship a
 * built-in heading node, so headings are implemented as block elements that
 * render as `<h1>` / `<h2>` / `<h3>` and round-trip through serialized editor
 * state with their tag preserved.
 */
export class HeadingNode extends ElementNode {
  __tag: HeadingTag;

  static getType(): string {
    return "heading";
  }

  static clone(node: HeadingNode): HeadingNode {
    return new HeadingNode(node.__tag, node.__key);
  }

  constructor(tag: HeadingTag, key?: NodeKey) {
    super(key);
    this.__tag = tag;
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement(this.__tag);
    return element;
  }

  updateDOM(_prevNode: HeadingNode, _dom: HTMLElement): boolean {
    return false;
  }

  static importJSON(serializedNode: SerializedHeadingNode): HeadingNode {
    const node = $createHeadingNode(serializedNode.tag);
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    node.setDirection(serializedNode.direction);
    return node;
  }

  exportJSON(): SerializedHeadingNode {
    return {
      ...super.exportJSON(),
      type: this.getType(),
      tag: this.__tag,
    } as SerializedHeadingNode;
  }

  insertNewAfter(
    _selection: RangeSelection,
    _restoreSelection?: boolean,
  ): null | LexicalNode {
    const newNode = $createParagraphNode();
    this.insertAfter(newNode, _restoreSelection);
    return newNode;
  }

  excludeFromCopy(_destination?: "clone" | "html"): boolean {
    return false;
  }

  canInsertAfter(_node: LexicalNode): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  extractWithChild(
    _child: LexicalNode,
    _selection: BaseSelection | null,
    _destination: "clone" | "html",
  ): boolean {
    return true;
  }

  getType(): string {
    return HeadingNode.getType();
  }

  createTextNode(text: string): LexicalNode {
    return $createTextNode(text);
  }

  getTag(): HeadingTag {
    return this.__tag;
  }

  setTag(tag: HeadingTag): void {
    const writable = this.getWritable() as HeadingNode;
    writable.__tag = tag;
  }
}

export type SerializedImageNode = SerializedElementNode & {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
};

export function $createImageNode(
  src: string,
  alt: string,
  width: number | null,
  height: number | null,
): ImageNode {
  return new ImageNode(src, alt, width, height);
}

/**
 * Custom Lexical element node for images. Renders an `` and supports
 * optional width/height constraints. Serializes src/alt/width/height so the
 * image round-trips through editor state.
 */
export class ImageNode extends ElementNode {
  __src: string;
  __alt: string;
  __width: number | null;
  __height: number | null;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__alt, node.__width, node.__height, node.__key);
  }

  constructor(
    src: string,
    alt: string,
    width: number | null,
    height: number | null,
    key?: NodeKey,
  ) {
    super(key);
    this.__src = src;
    this.__alt = alt;
    this.__width = width;
    this.__height = height;
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const img = document.createElement("img");
    img.src = this.__src;
    img.alt = this.__alt;
    if (this.__width !== null) img.style.width = `${this.__width}px`;
    if (this.__height !== null) img.style.height = `${this.__height}px`;
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.style.display = "block";
    img.style.margin = "0 auto";
    return img;
  }

  updateDOM(_prevNode: ImageNode, dom: HTMLElement): boolean {
    const img = dom as HTMLImageElement;
    if (img.src !== this.__src) img.src = this.__src;
    if (img.alt !== this.__alt) img.alt = this.__alt;
    if (this.__width !== null) img.style.width = `${this.__width}px`;
    else img.style.removeProperty("width");
    if (this.__height !== null) img.style.height = `${this.__height}px`;
    else img.style.removeProperty("height");
    return false;
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return new ImageNode(
      serializedNode.src,
      serializedNode.alt,
      serializedNode.width ?? null,
      serializedNode.height ?? null,
    );
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      type: this.getType(),
      src: this.__src,
      alt: this.__alt,
      width: this.__width,
      height: this.__height,
    } as SerializedImageNode;
  }

  insertNewAfter(
    _selection: RangeSelection,
    _restoreSelection?: boolean,
  ): null | LexicalNode {
    const newNode = $createParagraphNode();
    this.insertAfter(newNode, _restoreSelection);
    return newNode;
  }

  excludeFromCopy(_destination?: "clone" | "html"): boolean {
    return false;
  }

  canInsertAfter(_node: LexicalNode): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  extractWithChild(
    _child: LexicalNode,
    _selection: BaseSelection | null,
    _destination: "clone" | "html",
  ): boolean {
    return true;
  }

  getType(): string {
    return ImageNode.getType();
  }

  createTextNode(text: string): LexicalNode {
    return $createTextNode(text);
  }

  getSrc(): string {
    return this.__src;
  }

  getAlt(): string {
    return this.__alt;
  }

  getWidth(): number | null {
    return this.__width;
  }

  getHeight(): number | null {
    return this.__height;
  }

  setSrc(src: string): void {
    const writable = this.getWritable() as ImageNode;
    writable.__src = src;
  }

  setAlt(alt: string): void {
    const writable = this.getWritable() as ImageNode;
    writable.__alt = alt;
  }

  setWidth(width: number | null): void {
    const writable = this.getWritable() as ImageNode;
    writable.__width = width;
  }

  setHeight(height: number | null): void {
    const writable = this.getWritable() as ImageNode;
    writable.__height = height;
  }
}
