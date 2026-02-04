# Research Memory Scripts

Scripts for working with past research documents.

All script paths below are relative to this skill's directory.

## Available Scripts

| Script | Purpose | Use When |
|--------|---------|----------|
| `scripts/list-research.py` | List past research docs with metadata | Starting research, checking what exists |
| `scripts/search-research.py` | Search past research by topic or tags | Looking for specific past findings |
| `scripts/read-research.py` | Read full content of a research doc | Loading a specific document by path |
| `scripts/gather-metadata.py` | Generate frontmatter metadata | Creating a new research document |
| `scripts/promote-research.py` | Copy local research to global | Making project research available everywhere |

## Usage

Run scripts with `python3` using the path relative to this skill directory. Examples below show the script path and available arguments.

### List recent research

Run `scripts/list-research.py` to see recent research docs.

Arguments:
- `--limit N`: Max results (default: 10)
- `--location project|global|both`: Which directory (default: both)

### Search for topic

Run `scripts/search-research.py` with a search term to find related research.

Arguments:
- First positional: Search term (required)
- `--tags`: Filter by tags (comma-separated)
- `--limit N`: Max results (default: 5)

### Read full content

Run `scripts/read-research.py` with a path to load a research document. Use paths returned by `scripts/list-research.py` or `scripts/search-research.py`.

### Generate metadata

Run `scripts/gather-metadata.py` to get deterministic metadata for research documents.

Returns key-value pairs: `date`, `filename_date`, `cwd`, `repository`, `branch`, `commit`

### Promote to global

Run `scripts/promote-research.py` with a filename from `.research/` to copy it to `~/.research/`.

Arguments:
- First positional: Filename in `.research/` (required)
- `--move`: Move instead of copy (removes local)

**User might say:**
- "Make that research available globally"
- "I want to reference this from other projects"
- "Move this to global research"
- "Save this so I can use it elsewhere"

## Research Directories

| Location | Path | Use For |
|----------|------|---------|
| Project | `.agents/research/` | Project-specific research |
| Global | `~/.agents/research/` | Cross-project knowledge |
