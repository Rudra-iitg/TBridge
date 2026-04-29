# Graphify Workflow

Graphify will be used as the project knowledge graph layer. Its job is to help
future coding sessions answer architecture questions without rereading the
entire repository.

## Intended Use

Graphify should index:

- source code
- planning docs
- protocol definitions
- security decisions
- architecture diagrams
- implementation notes

The expected output directory is:

```text
graphify-out/
├── graph.html
├── graph.json
└── GRAPH_REPORT.md
```

## Installation

Use the Graphify distribution that provides the `graphify` CLI for knowledge
graph generation.

```bash
pip install graphifyy
graphify install
```

If a different Graphify distribution is selected later, this document should be
updated before wiring it into scripts.

## Manual Run

From the repository root:

```bash
graphify . --output graphify-out
```

If the installed CLI uses the slash-command style documented by the project,
run:

```bash
/graphify .
```

## What To Commit

Commit:

- Graphify workflow docs.
- Any script wrappers we create.
- Small architecture reports if they are useful for review.

Do not commit by default:

- large generated graph artifacts
- private corpus data
- files containing terminal transcripts or secrets

The final policy can be enforced in `.gitignore` once we scaffold the project.

## Planned Integration

Add scripts after the TypeScript workspace is created:

```json
{
  "scripts": {
    "graph:build": "graphify . --output graphify-out",
    "graph:report": "graphify . --output graphify-out && cat graphify-out/GRAPH_REPORT.md"
  }
}
```

## Knowledge Graph Boundaries

Graphify is for understanding the codebase. It is not part of the runtime path
for remote terminal sessions.

Runtime:

```text
CLI <-> relay server <-> CLI
```

Development intelligence:

```text
repo docs/source -> Graphify -> graph.html/graph.json/GRAPH_REPORT.md
```
