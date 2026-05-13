ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
NVIM ?= nvim
NPM ?= npm
FILE ?= README.md
DEV_HOME := $(ROOT)/.nvim-dev
DEV_ENV := XDG_CONFIG_HOME="$(DEV_HOME)/config" XDG_DATA_HOME="$(DEV_HOME)/data" XDG_STATE_HOME="$(DEV_HOME)/state" XDG_CACHE_HOME="$(DEV_HOME)/cache" LEARN_NVIM_ROOT="$(ROOT)"
CODEX_MODEL ?= gpt-5.4-mini
CODEX_COMMAND ?= codex
CODEX_TIMEOUT_MS ?= 300000
CODEX_ANNOTATION_TIMEOUT_MS ?= 30000
OLLAMA_MODEL ?= qwen3:1.7b
OLLAMA_BASE_URL ?= http://localhost:11434
OLLAMA_TIMEOUT_MS ?= 60000
OLLAMA_ANNOTATION_TIMEOUT_MS ?= 20000
CHATGPT_MODEL ?= gpt-4o-mini
CHATGPT_API_KEY ?= $(OPENAI_API_KEY)
CHATGPT_TIMEOUT_MS ?= 300000
CHATGPT_ANNOTATION_TIMEOUT_MS ?= 30000
E2E_WAIT_MS ?= 30000
E2E_DIR := $(DEV_HOME)/e2e
TRACE_DIR := $(DEV_HOME)/trace
CODEX_STUB := $(ROOT)/nvim/tests/codex-stub.js

.PHONY: test run run-codex run-codex-stub run-ollama run-chatgpt compile lint test-dev-init test-dev-init-codex test-dev-init-ollama test-dev-init-chatgpt e2e-annotations e2e-annotations-real e2e-annotations-ollama e2e-annotations-chatgpt e2e-dirs trace-dirs dev-dirs

dev-dirs:
	mkdir -p "$(DEV_HOME)/config" "$(DEV_HOME)/data" "$(DEV_HOME)/state" "$(DEV_HOME)/cache"

e2e-dirs: dev-dirs
	mkdir -p "$(E2E_DIR)"

trace-dirs: dev-dirs
	mkdir -p "$(TRACE_DIR)"

compile:
	$(NPM) run compile

lint:
	$(NPM) run lint

test: dev-dirs test-dev-init test-dev-init-codex test-dev-init-ollama test-dev-init-chatgpt e2e-annotations
	$(DEV_ENV) $(NPM) run test:mvp

run: dev-dirs compile
	$(DEV_ENV) $(NVIM) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

run-codex: trace-dirs compile
	$(DEV_ENV) LEARN_DEV_PROVIDER=codex LEARN_PROVIDER=codex LEARN_CODEX_MODEL="$(CODEX_MODEL)" LEARN_CODEX_COMMAND="$(CODEX_COMMAND)" LEARN_CODEX_TIMEOUT_MS="$(CODEX_TIMEOUT_MS)" LEARN_CODEX_ANNOTATION_TIMEOUT_MS="$(CODEX_ANNOTATION_TIMEOUT_MS)" LEARN_CODEX_TRACE_PROMPT_PATH="$(TRACE_DIR)/codex-prompt.txt" LEARN_CODEX_TRACE_RESPONSE_PATH="$(TRACE_DIR)/codex-response.txt" $(NVIM) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

run-ollama: trace-dirs compile
	$(DEV_ENV) LEARN_DEV_PROVIDER=ollama LEARN_PROVIDER=ollama LEARN_OLLAMA_MODEL="$(OLLAMA_MODEL)" LEARN_OLLAMA_BASE_URL="$(OLLAMA_BASE_URL)" LEARN_OLLAMA_TIMEOUT_MS="$(OLLAMA_TIMEOUT_MS)" LEARN_OLLAMA_ANNOTATION_TIMEOUT_MS="$(OLLAMA_ANNOTATION_TIMEOUT_MS)" LEARN_OLLAMA_TRACE_PROMPT_PATH="$(TRACE_DIR)/ollama-prompt.txt" LEARN_OLLAMA_TRACE_RESPONSE_PATH="$(TRACE_DIR)/ollama-response.txt" $(NVIM) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

run-chatgpt: trace-dirs compile
	$(DEV_ENV) LEARN_DEV_PROVIDER=chatgpt LEARN_PROVIDER=chatgpt LEARN_CHATGPT_MODEL="$(CHATGPT_MODEL)" LEARN_CHATGPT_API_KEY="$(CHATGPT_API_KEY)" LEARN_CHATGPT_TIMEOUT_MS="$(CHATGPT_TIMEOUT_MS)" LEARN_CHATGPT_ANNOTATION_TIMEOUT_MS="$(CHATGPT_ANNOTATION_TIMEOUT_MS)" LEARN_CHATGPT_TRACE_PROMPT_PATH="$(TRACE_DIR)/chatgpt-prompt.txt" LEARN_CHATGPT_TRACE_RESPONSE_PATH="$(TRACE_DIR)/chatgpt-response.txt" $(NVIM) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

run-codex-stub: e2e-dirs compile
	chmod +x "$(CODEX_STUB)"
	$(DEV_ENV) LEARN_DEV_PROVIDER=codex LEARN_PROVIDER=codex LEARN_CODEX_MODEL="$(CODEX_MODEL)" LEARN_CODEX_COMMAND="$(CODEX_STUB)" LEARN_CODEX_TIMEOUT_MS="$(CODEX_TIMEOUT_MS)" LEARN_CODEX_ANNOTATION_TIMEOUT_MS="$(CODEX_ANNOTATION_TIMEOUT_MS)" LEARN_CODEX_TRACE_PROMPT_PATH="$(E2E_DIR)/codex-prompt.txt" LEARN_CODEX_TRACE_RESPONSE_PATH="$(E2E_DIR)/codex-response.txt" $(NVIM) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

e2e-annotations: e2e-dirs compile
	chmod +x "$(CODEX_STUB)"
	$(DEV_ENV) LEARN_DEV_PROVIDER=codex LEARN_PROVIDER=codex LEARN_CODEX_MODEL="$(CODEX_MODEL)" LEARN_CODEX_COMMAND="$(CODEX_STUB)" LEARN_CODEX_TIMEOUT_MS="$(CODEX_TIMEOUT_MS)" LEARN_CODEX_ANNOTATION_TIMEOUT_MS="$(CODEX_ANNOTATION_TIMEOUT_MS)" LEARN_E2E_WAIT_MS="$(E2E_WAIT_MS)" LEARN_E2E_ARTIFACT_PATH="$(E2E_DIR)/annotations.json" LEARN_CODEX_TRACE_PROMPT_PATH="$(E2E_DIR)/codex-prompt.txt" LEARN_CODEX_TRACE_RESPONSE_PATH="$(E2E_DIR)/codex-response.txt" $(NVIM) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/e2e_annotations_spec.lua').run()" -c "qa!"
	@cat "$(E2E_DIR)/annotations.json"

e2e-annotations-real: e2e-dirs compile
	$(DEV_ENV) LEARN_DEV_PROVIDER=codex LEARN_PROVIDER=codex LEARN_CODEX_MODEL="$(CODEX_MODEL)" LEARN_CODEX_COMMAND="$(CODEX_COMMAND)" LEARN_CODEX_TIMEOUT_MS="$(CODEX_TIMEOUT_MS)" LEARN_CODEX_ANNOTATION_TIMEOUT_MS="$(CODEX_ANNOTATION_TIMEOUT_MS)" LEARN_E2E_WAIT_MS="$(E2E_WAIT_MS)" LEARN_E2E_ARTIFACT_PATH="$(E2E_DIR)/annotations-real.json" LEARN_CODEX_TRACE_PROMPT_PATH="$(E2E_DIR)/codex-prompt-real.txt" LEARN_CODEX_TRACE_RESPONSE_PATH="$(E2E_DIR)/codex-response-real.txt" $(NVIM) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/e2e_annotations_spec.lua').run()" -c "qa!"
	@cat "$(E2E_DIR)/annotations-real.json"

e2e-annotations-ollama: e2e-dirs compile
	$(DEV_ENV) LEARN_DEV_PROVIDER=ollama LEARN_PROVIDER=ollama LEARN_OLLAMA_MODEL="$(OLLAMA_MODEL)" LEARN_OLLAMA_BASE_URL="$(OLLAMA_BASE_URL)" LEARN_OLLAMA_TIMEOUT_MS="$(OLLAMA_TIMEOUT_MS)" LEARN_OLLAMA_ANNOTATION_TIMEOUT_MS="$(OLLAMA_ANNOTATION_TIMEOUT_MS)" LEARN_E2E_WAIT_MS="$(E2E_WAIT_MS)" LEARN_E2E_ARTIFACT_PATH="$(E2E_DIR)/annotations-ollama.json" LEARN_OLLAMA_TRACE_PROMPT_PATH="$(E2E_DIR)/ollama-prompt.txt" LEARN_OLLAMA_TRACE_RESPONSE_PATH="$(E2E_DIR)/ollama-response.txt" $(NVIM) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/e2e_annotations_spec.lua').run()" -c "qa!"
	@cat "$(E2E_DIR)/annotations-ollama.json"

e2e-annotations-chatgpt: e2e-dirs compile
	$(DEV_ENV) LEARN_DEV_PROVIDER=chatgpt LEARN_PROVIDER=chatgpt LEARN_CHATGPT_MODEL="$(CHATGPT_MODEL)" LEARN_CHATGPT_API_KEY="$(CHATGPT_API_KEY)" LEARN_CHATGPT_TIMEOUT_MS="$(CHATGPT_TIMEOUT_MS)" LEARN_CHATGPT_ANNOTATION_TIMEOUT_MS="$(CHATGPT_ANNOTATION_TIMEOUT_MS)" LEARN_E2E_WAIT_MS="$(E2E_WAIT_MS)" LEARN_E2E_ARTIFACT_PATH="$(E2E_DIR)/annotations-chatgpt.json" LEARN_CHATGPT_TRACE_PROMPT_PATH="$(E2E_DIR)/chatgpt-prompt.txt" LEARN_CHATGPT_TRACE_RESPONSE_PATH="$(E2E_DIR)/chatgpt-response.txt" $(NVIM) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/e2e_annotations_spec.lua').run()" -c "qa!"
	@cat "$(E2E_DIR)/annotations-chatgpt.json"

test-dev-init: dev-dirs compile
	$(DEV_ENV) $(NVIM) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa

test-dev-init-codex: dev-dirs compile
	$(DEV_ENV) LEARN_DEV_PROVIDER=codex $(NVIM) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa

test-dev-init-ollama: dev-dirs compile
	$(DEV_ENV) LEARN_DEV_PROVIDER=ollama $(NVIM) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa

test-dev-init-chatgpt: dev-dirs compile
	$(DEV_ENV) LEARN_DEV_PROVIDER=chatgpt $(NVIM) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa
