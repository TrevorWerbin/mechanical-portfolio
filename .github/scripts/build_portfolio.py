#!/usr/bin/env python3
import os
import shutil
import html
import re
from pathlib import Path

from markdown import markdown

ROOT = Path(__file__).resolve().parents[2]
SITE_ROOT = ROOT / "site"
PROJECTS = [
    p for p in sorted(ROOT.iterdir())
    if p.is_dir() and not p.name.startswith(".") and p.name not in {"site", ".git", ".github"}
]

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".m4v"}
PDF_EXTS = {".pdf"}
THREE_D_EXTS = {".obj", ".stl", ".glb", ".gltf", ".dae"}
TEXT_EXTS = {".md", ".txt", ".csv"}


def sanitize_name(name: str) -> str:
    return html.escape(name, quote=True)


def relative_url_from(path: Path) -> str:
    return path.relative_to(SITE_ROOT).as_posix()


def ensure_clean_dir(path: Path):
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def copy_directory_contents(src: Path, dst: Path):
    for child in src.iterdir():
        target = dst / child.name
        if child.is_dir():
            shutil.copytree(child, target, dirs_exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(child, target)


def file_kind(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in IMAGE_EXTS:
        return "image"
    if suffix in VIDEO_EXTS:
        return "video"
    if suffix in PDF_EXTS:
        return "pdf"
    if suffix in THREE_D_EXTS:
        return "3d"
    if suffix in TEXT_EXTS:
        return "text"
    return "file"


def render_markdown(md_path: Path) -> str:
    try:
        content = md_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        content = md_path.read_text(encoding="utf-8", errors="replace")
    return markdown(content, extensions=["extra", "sane_lists", "tables", "toc"])


def render_asset_card(asset_rel: str, asset_path: Path) -> str:
    display_name = asset_path.name
    label = sanitize_name(display_name)
    kind = file_kind(asset_path)
    href = f"./{asset_rel}"

    if kind == "image":
        return f'''
        <div class="asset-card">
          <h4>{label}</h4>
          <img src="{href}" alt="{label}" />
        </div>
        '''
    if kind == "video":
        return f'''
        <div class="asset-card">
          <h4>{label}</h4>
          <video controls src="{href}"></video>
        </div>
        '''
    if kind == "pdf":
        return f'''
        <div class="asset-card">
          <h4>{label}</h4>
          <embed src="{href}" type="application/pdf" />
          <p><a href="{href}" target="_blank" rel="noreferrer">Open PDF</a></p>
        </div>
        '''
    if kind == "3d":
        return f'''
        <div class="asset-card">
          <h4>{label}</h4>
          <model-viewer src="{href}" alt="{label}" auto-rotate camera-controls shadow-intensity="1" style="width: 100%; height: 360px; background: #0f172a;"></model-viewer>
          <p><a href="{href}" target="_blank" rel="noreferrer">Open 3D asset</a></p>
        </div>
        '''
    if kind == "text":
        if asset_path.suffix.lower() == ".md":
            markdown_html = render_markdown(asset_path)
            return f'''
            <div class="asset-card markdown-card">
              <h4>{label}</h4>
              <div class="markdown-content">{markdown_html}</div>
            </div>
            '''
        return f'''
        <div class="asset-card">
          <h4>{label}</h4>
          <pre>{sanitize_name(asset_path.read_text(encoding='utf-8', errors='replace'))[:2000]}</pre>
          <p><a href="{href}" target="_blank" rel="noreferrer">Open file</a></p>
        </div>
        '''
    return f'''
    <div class="asset-card">
      <h4>{label}</h4>
      <p><a href="{href}" target="_blank" rel="noreferrer">Open file</a></p>
    </div>
    '''


def tree_lines_for_directory(directory: Path, prefix: str = "") -> list[str]:
    lines: list[str] = []
    children = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    for index, child in enumerate(children):
        is_last = index == len(children) - 1
        connector = "└── " if is_last else "├── "
        lines.append(f"{prefix}{connector}{child.name}")
        if child.is_dir():
            next_prefix = prefix + ("    " if is_last else "│   ")
            lines.extend(tree_lines_for_directory(child, next_prefix))
    return lines


def render_project_page(project_dir: Path, site_dir: Path):
    project_name = project_dir.name
    output_file = site_dir / project_dir.name / "index.html"
    output_file.parent.mkdir(parents=True, exist_ok=True)

    asset_entries = []
    all_files = []
    for child in sorted(project_dir.rglob("*"), key=lambda p: p.relative_to(project_dir).as_posix().lower()):
        if child.is_file() and not child.name.startswith("."):
            all_files.append(child)

    for asset in all_files:
        rel_path = asset.relative_to(project_dir).as_posix()
        asset_path = Path(".") / project_name / rel_path
        asset_entries.append(render_asset_card(asset_path.as_posix(), asset))

    tree_text = "\n".join(f"{project_name}\n" + "\n".join(tree_lines_for_directory(project_dir)))

    readme_html = ""
    readme_path = project_dir / "README.md"
    if readme_path.exists():
        readme_html = f"<div class='readme-block'>{render_markdown(readme_path)}</div>"

    project_cards = "".join(asset_entries)
    html_doc = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{sanitize_name(project_name)}</title>
  <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.11.0/model-viewer.min.js"></script>
  <style>
    :root {{
      --bg: #0f172a;
      --panel: #111827;
      --panel-alt: #1f2937;
      --muted: #94a3b8;
      --heading: #e2e8f0;
      --link: #7dd3fc;
      --border: #334155;
      --accent: #38bdf8;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      background: linear-gradient(180deg, #020817, #0f172a 35%, #111827);
      color: var(--heading);
    }}
    .container {{ max-width: 1200px; margin: 0 auto; padding: 32px 18px 80px; }}
    h1, h2, h3, h4 {{ margin-top: 0; }}
    a {{ color: var(--link); text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    .topbar {{
      display: flex; justify-content: space-between; align-items: center;
      padding: 18px 0 24px; border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }}
    .layout {{ display: grid; grid-template-columns: 340px 1fr; gap: 24px; }}
    .sidebar, .content {{
      background: rgba(17, 24, 39, 0.9);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
    }}
    .tree {{ margin: 0; padding-left: 16px; color: var(--heading); white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.6; }}
    .asset-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }}
    .asset-card {{
      background: var(--panel-alt); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 18px;
    }}
    .asset-card img, .asset-card video, .asset-card embed, model-viewer {{
      display: block; width: 100%; max-height: 360px; object-fit: contain; border-radius: 8px; margin-top: 10px;
    }}
    .asset-card pre {{ white-space: pre-wrap; word-break: break-word; background: rgba(15,23,42,0.8); padding: 10px; border-radius: 8px; }}
    .markdown-content {{ line-height: 1.7; color: #e2e8f0; }}
    .markdown-content img {{ max-width: 100%; border-radius: 8px; }}
    .markdown-content table {{ border-collapse: collapse; width: 100%; }}
    .markdown-content th, .markdown-content td {{ border: 1px solid var(--border); padding: 8px; text-align: left; }}
    @media (max-width: 860px) {{ .layout {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h1>{sanitize_name(project_name)}</h1>
      <a href="../index.html">← Back to portfolio</a>
    </div>

    <div class="layout">
      <aside class="sidebar">
        <h2>Folder tree</h2>
        <pre class="tree">{sanitize_name(tree_text)}</pre>
      </aside>

      <main class="content">
        {readme_html}
        <div class="asset-grid">{project_cards}</div>
      </main>
    </div>
  </div>
</body>
</html>
"""
    output_file.write_text(html_doc, encoding="utf-8")


def create_homepage(projects: list[Path]):
    cards = []
    for project in projects:
        project_name = project.name
        project_link = f"./{project_name}/index.html"
        cards.append(f'''<div class="card"><h3><a href="{project_link}">{sanitize_name(project_name)}</a></h3><p>{sanitize_name(project_name)}</p></div>''')

    html_doc = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mechanical Portfolio</title>
  <style>
    :root {{
      --bg: #020817;
      --panel: #111827;
      --panel-alt: #1e293b;
      --heading: #e2e8f0;
      --muted: #94a3b8;
      --border: #334155;
      --link: #7dd3fc;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; font-family: Arial, Helvetica, sans-serif; background: linear-gradient(180deg, #020817, #0f172a 35%, #111827); color: var(--heading);
    }}
    .container {{ max-width: 1100px; margin: 0 auto; padding: 32px 16px 80px; }}
    h1 {{ margin-bottom: 28px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; }}
    .card {{ background: rgba(17, 24, 39, 0.95); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }}
    .card h3 {{ margin-top: 0; }}
    a {{ color: var(--link); text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    .subtitle {{ color: var(--muted); margin-bottom: 20px; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>Mechanical Engineering Portfolio</h1>
    <div class="subtitle">Browse project folders and embedded assets</div>
    <div class="grid">{''.join(cards)}</div>
  </div>
</body>
</html>
"""
    (SITE_ROOT / "index.html").write_text(html_doc, encoding="utf-8")


def main():
    ensure_clean_dir(SITE_ROOT)

    for project in PROJECTS:
        project_site_dir = SITE_ROOT / project.name
        project_site_dir.mkdir(parents=True, exist_ok=True)
        copy_directory_contents(project, project_site_dir)
        render_project_page(project, SITE_ROOT)

    create_homepage(PROJECTS)

    if (ROOT / "README.md").exists():
        root_readme_path = ROOT / "README.md"
        shutil.copy2(root_readme_path, SITE_ROOT / "README.md")

    print(f"Built portfolio site in {SITE_ROOT} with {len(PROJECTS)} projects.")


if __name__ == "__main__":
    main()
