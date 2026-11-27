# Web research and model transformation adapters

Skai uses these upstream projects through explicit adapter boundaries. Their
source trees stay outside the Skai binary, which keeps the app able to update
independently and preserves each upstream license boundary. Firecrawl,
Heretic, and OBLITERATUS are AGPL-3.0 projects; the Transformers prototype is
Apache-2.0.

## Firecrawl

The existing research path checks `http://127.0.0.1:3002/health`. When a local
Firecrawl Local server responds, Skai sends research searches to `/v2/search`
and page extraction to `/v2/scrape`. If it is unavailable, Skai keeps the
existing DuckDuckGo/Bing search and direct page extraction fallback.

To use another operator-managed endpoint, set `SKAI_FIRECRAWL_ENDPOINT` before
starting the Agent Host. `FIRECRAWL_API_KEY` is read from the process
environment for cloud routes and is never stored in Skai settings.

## Model transformation adapters

The Marketplace discovers these checkouts under `.tmp/github-checkouts` or
under the path in `SKAI_MODEL_TOOLS_ROOT`:

- Heretic: planning and license/runtime disclosure are available; its current
  interactive save workflow remains research-only in Skai.
- OBLITERATUS: Skai can plan and launch the bounded `obliterate` CLI against a
  selected model folder and a different output folder.
- Remove refusals with Transformers: cataloged as an experimental research
  adapter. Its upstream scripts contain hard-coded model and direction setup,
  so Skai does not silently rewrite or execute them.

Every transformation requires separate source and output folders, explicit
confirmation, and an installed Python/PyTorch environment. Skai does not
install dependencies or add the generated model to a runtime automatically.
The output must be reviewed before it is imported into Ollama, LM Studio, or
another local runtime.

The Agent Host methods are `model.transformers.list`,
`model.transformers.plan`, `model.transformers.start`,
`model.transformers.status`, and `model.transformers.cancel`.

## Internet Marketplace discovery

The Marketplace's Internet section uses bounded, cached discovery rather than
pretending that every online result is a Skai plugin. Hugging Face supplies LLM,
image, and voice model results; GitHub supplies skills and developer-tool
repositories; and the official MCP Registry supplies MCP server metadata. Each
result keeps its source URL and is marked as discovery-only unless Skai has a
separate reviewed installer. Results are paginated and can be loaded in batches
from the UI. Arbitrary remote repositories are never executed automatically.

The Agent Host method is `marketplace.internet.search` with `category` values
`all`, `llm`, `image`, `voice`, `skills`, `tools`, or `mcp`.
