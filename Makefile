ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
NVIM ?= nvim
NPM ?= npm
FILE ?= README.md
DEV_HOME := $(ROOT)/.nvim-dev
DEV_ENV := XDG_CONFIG_HOME="$(DEV_HOME)/config" XDG_DATA_HOME="$(DEV_HOME)/data" XDG_STATE_HOME="$(DEV_HOME)/state" XDG_CACHE_HOME="$(DEV_HOME)/cache"
DEV_ROOT := --cmd "let g:vantage_nvim_root='$(ROOT)'"
CODEX_MODEL ?= gpt-5.4-mini
CODEX_COMMAND ?= codex
CODEX_TIMEOUT_MS ?= 300000
CODEX_ANNOTATION_TIMEOUT_MS ?= 30000
OLLAMA_MODEL ?= qwen3:1.7b
OLLAMA_BASE_URL ?= http://localhost:11434
OLLAMA_TIMEOUT_MS ?= 60000
OLLAMA_ANNOTATION_TIMEOUT_MS ?= 20000
CHATGPT_MODEL ?= gpt-4o-mini
CHATGPT_TIMEOUT_MS ?= 300000
CHATGPT_ANNOTATION_TIMEOUT_MS ?= 30000
PI_PROVIDER ?= openai
PI_MODEL ?= gpt-4o-mini
PI_TIMEOUT_MS ?= 300000
PI_ANNOTATION_TIMEOUT_MS ?= 30000
E2E_WAIT_MS ?= 30000
E2E_DIR := $(DEV_HOME)/e2e
TRACE_DIR := $(DEV_HOME)/trace
CODEX_STUB := $(ROOT)/nvim/tests/codex-stub.js
CODEX_DEV := --cmd "let g:vantage_dev_provider='codex'" --cmd "let g:vantage_codex_model='$(CODEX_MODEL)'" --cmd "let g:vantage_codex_command='$(CODEX_COMMAND)'" --cmd "let g:vantage_codex_timeout_ms=$(CODEX_TIMEOUT_MS)" --cmd "let g:vantage_codex_annotation_timeout_ms=$(CODEX_ANNOTATION_TIMEOUT_MS)"
OLLAMA_DEV := --cmd "let g:vantage_dev_provider='ollama'" --cmd "let g:vantage_ollama_model='$(OLLAMA_MODEL)'" --cmd "let g:vantage_ollama_base_url='$(OLLAMA_BASE_URL)'" --cmd "let g:vantage_ollama_timeout_ms=$(OLLAMA_TIMEOUT_MS)" --cmd "let g:vantage_ollama_annotation_timeout_ms=$(OLLAMA_ANNOTATION_TIMEOUT_MS)"
CHATGPT_DEV := --cmd "let g:vantage_dev_provider='chatgpt'" --cmd "let g:vantage_chatgpt_model='$(CHATGPT_MODEL)'" --cmd "let g:vantage_chatgpt_timeout_ms=$(CHATGPT_TIMEOUT_MS)" --cmd "let g:vantage_chatgpt_annotation_timeout_ms=$(CHATGPT_ANNOTATION_TIMEOUT_MS)"
PI_DEV := --cmd "let g:vantage_dev_provider='pi'" --cmd "let g:vantage_pi_provider='$(PI_PROVIDER)'" --cmd "let g:vantage_pi_model='$(PI_MODEL)'" --cmd "let g:vantage_pi_timeout_ms=$(PI_TIMEOUT_MS)" --cmd "let g:vantage_pi_annotation_timeout_ms=$(PI_ANNOTATION_TIMEOUT_MS)"

.PHONY: test run run-codex run-codex-stub run-ollama run-chatgpt run-pi compile lint test-dev-init test-dev-init-codex test-dev-init-ollama test-dev-init-chatgpt test-dev-init-pi e2e-annotations e2e-annotations-real e2e-annotations-ollama e2e-annotations-chatgpt e2e-dirs trace-dirs dev-dirs

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

test: dev-dirs test-dev-init test-dev-init-codex test-dev-init-ollama test-dev-init-chatgpt test-dev-init-pi e2e-annotations
	$(DEV_ENV) $(NPM) run test:mvp

run: dev-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

run-codex: trace-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) $(CODEX_DEV) --cmd "let g:vantage_codex_trace_prompt_path='$(TRACE_DIR)/codex-prompt.txt'" --cmd "let g:vantage_codex_trace_response_path='$(TRACE_DIR)/codex-response.txt'" --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

run-ollama: trace-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) $(OLLAMA_DEV) --cmd "let g:vantage_ollama_trace_prompt_path='$(TRACE_DIR)/ollama-prompt.txt'" --cmd "let g:vantage_ollama_trace_response_path='$(TRACE_DIR)/ollama-response.txt'" --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

run-chatgpt: trace-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) $(CHATGPT_DEV) --cmd "let g:vantage_chatgpt_trace_prompt_path='$(TRACE_DIR)/chatgpt-prompt.txt'" --cmd "let g:vantage_chatgpt_trace_response_path='$(TRACE_DIR)/chatgpt-response.txt'" --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

run-pi: trace-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) $(PI_DEV) --cmd "let g:vantage_pi_trace_prompt_path='$(TRACE_DIR)/pi-prompt.txt'" --cmd "let g:vantage_pi_trace_response_path='$(TRACE_DIR)/pi-response.txt'" --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

run-codex-stub: e2e-dirs compile
	chmod +x "$(CODEX_STUB)"
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --cmd "let g:vantage_dev_provider='codex'" --cmd "let g:vantage_codex_model='$(CODEX_MODEL)'" --cmd "let g:vantage_codex_command='$(CODEX_STUB)'" --cmd "let g:vantage_codex_timeout_ms=$(CODEX_TIMEOUT_MS)" --cmd "let g:vantage_codex_annotation_timeout_ms=$(CODEX_ANNOTATION_TIMEOUT_MS)" --cmd "let g:vantage_codex_trace_prompt_path='$(E2E_DIR)/codex-prompt.txt'" --cmd "let g:vantage_codex_trace_response_path='$(E2E_DIR)/codex-response.txt'" --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

e2e-annotations: e2e-dirs compile
	chmod +x "$(CODEX_STUB)"
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --cmd "let g:vantage_dev_provider='codex'" --cmd "let g:vantage_codex_model='$(CODEX_MODEL)'" --cmd "let g:vantage_codex_command='$(CODEX_STUB)'" --cmd "let g:vantage_codex_timeout_ms=$(CODEX_TIMEOUT_MS)" --cmd "let g:vantage_codex_annotation_timeout_ms=$(CODEX_ANNOTATION_TIMEOUT_MS)" --cmd "let g:vantage_e2e_wait_ms=$(E2E_WAIT_MS)" --cmd "let g:vantage_e2e_artifact_path='$(E2E_DIR)/annotations.json'" --cmd "let g:vantage_codex_trace_prompt_path='$(E2E_DIR)/codex-prompt.txt'" --cmd "let g:vantage_codex_trace_response_path='$(E2E_DIR)/codex-response.txt'" --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/e2e_annotations_spec.lua').run()" -c "qa!"
	@cat "$(E2E_DIR)/annotations.json"

e2e-annotations-real: e2e-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) $(CODEX_DEV) --cmd "let g:vantage_e2e_wait_ms=$(E2E_WAIT_MS)" --cmd "let g:vantage_e2e_artifact_path='$(E2E_DIR)/annotations-real.json'" --cmd "let g:vantage_codex_trace_prompt_path='$(E2E_DIR)/codex-prompt-real.txt'" --cmd "let g:vantage_codex_trace_response_path='$(E2E_DIR)/codex-response-real.txt'" --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/e2e_annotations_spec.lua').run()" -c "qa!"
	@cat "$(E2E_DIR)/annotations-real.json"

e2e-annotations-ollama: e2e-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) $(OLLAMA_DEV) --cmd "let g:vantage_e2e_wait_ms=$(E2E_WAIT_MS)" --cmd "let g:vantage_e2e_artifact_path='$(E2E_DIR)/annotations-ollama.json'" --cmd "let g:vantage_ollama_trace_prompt_path='$(E2E_DIR)/ollama-prompt.txt'" --cmd "let g:vantage_ollama_trace_response_path='$(E2E_DIR)/ollama-response.txt'" --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/e2e_annotations_spec.lua').run()" -c "qa!"
	@cat "$(E2E_DIR)/annotations-ollama.json"

e2e-annotations-chatgpt: e2e-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) $(CHATGPT_DEV) --cmd "let g:vantage_e2e_wait_ms=$(E2E_WAIT_MS)" --cmd "let g:vantage_e2e_artifact_path='$(E2E_DIR)/annotations-chatgpt.json'" --cmd "let g:vantage_chatgpt_trace_prompt_path='$(E2E_DIR)/chatgpt-prompt.txt'" --cmd "let g:vantage_chatgpt_trace_response_path='$(E2E_DIR)/chatgpt-response.txt'" --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/e2e_annotations_spec.lua').run()" -c "qa!"
	@cat "$(E2E_DIR)/annotations-chatgpt.json"

test-dev-init: dev-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa

test-dev-init-codex: dev-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --cmd "let g:vantage_dev_provider='codex'" --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa

test-dev-init-ollama: dev-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --cmd "let g:vantage_dev_provider='ollama'" --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa

test-dev-init-chatgpt: dev-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --cmd "let g:vantage_dev_provider='chatgpt'" --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa

test-dev-init-pi: dev-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --cmd "let g:vantage_dev_provider='pi'" --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa
