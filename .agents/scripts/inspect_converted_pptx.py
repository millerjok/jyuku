import fitz
from pathlib import Path

source = Path(".agents/outputs/current-converted.pdf")
output_dir = Path(".agents/outputs/rendered-pptx")
output_dir.mkdir(parents=True, exist_ok=True)

document = fitz.open(source)
print(f"pages={document.page_count}")
for index, page in enumerate(document):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
    output = output_dir / f"page-{index + 1}.png"
    pixmap.save(output)
    blocks = page.get_text("dict")["blocks"]
    text_blocks = [block for block in blocks if block.get("type") == 0]
    print(f"page={index + 1} size={page.rect.width:.1f}x{page.rect.height:.1f} text_blocks={len(text_blocks)}")
    for block in text_blocks[:8]:
        print(" ", block["bbox"], " ".join(span["text"] for line in block["lines"] for span in line["spans"])[:180])