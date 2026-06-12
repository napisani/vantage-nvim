ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
NVIM ?= nvim
NPM ?= mise exec -- npm
FILE ?= README.md
DEV_HOME := $(ROOT)/.nvim-dev
DEV_ENV := XDG_CONFIG_HOME="$(DEV_HOME)/config" XDG_DATA_HOME="$(DEV_HOME)/data" XDG_STATE_HOME="$(DEV_HOME)/state" XDG_CACHE_HOME="$(DEV_HOME)/cache"
DEV_ROOT := --cmd "let g:vantage_nvim_root='$(ROOT)'"
PI_PROVIDER ?= openai
PI_MODEL ?= gpt-4o-mini
PI_TIMEOUT_MS ?= 300000
PI_ANNOTATION_TIMEOUT_MS ?= 300000
E2E_WAIT_MS ?= 120000
E2E_DIR := $(DEV_HOME)/e2e
TRACE_DIR := $(DEV_HOME)/trace
PI_DEV := --cmd "let g:vantage_dev_agent='pi'" --cmd "let g:vantage_pi_provider='$(PI_PROVIDER)'" --cmd "let g:vantage_pi_model='$(PI_MODEL)'" --cmd "let g:vantage_pi_timeout_ms=$(PI_TIMEOUT_MS)" --cmd "let g:vantage_pi_annotation_timeout_ms=$(PI_ANNOTATION_TIMEOUT_MS)"

.PHONY: test run run-pi compile lint test-dev-init test-dev-init-pi e2e-annotations e2e-model e2e-dirs trace-dirs dev-dirs

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

test: dev-dirs test-dev-init e2e-annotations
	$(DEV_ENV) $(NPM) run test:mvp

run: dev-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

run-pi: trace-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) $(PI_DEV) --cmd "let g:vantage_pi_trace_prompt_path='$(TRACE_DIR)/pi-prompt.txt'" --cmd "let g:vantage_pi_trace_response_path='$(TRACE_DIR)/pi-response.txt'" --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

e2e-annotations: e2e-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --cmd "let g:vantage_e2e_wait_ms=$(E2E_WAIT_MS)" --cmd "let g:vantage_e2e_artifact_path='$(E2E_DIR)/annotations.json'" --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/e2e_annotations_spec.lua').run()" -c "qa!"
	@cat "$(E2E_DIR)/annotations.json"

e2e-model: e2e-dirs compile
	cd "$(ROOT)/examples/e2e-codebase" && $(DEV_ENV) $(NVIM) $(DEV_ROOT) $(PI_DEV) --cmd "let g:vantage_e2e_wait_ms=$(E2E_WAIT_MS)" --cmd "let g:vantage_e2e_codebase_path='$(ROOT)/examples/e2e-codebase'" --cmd "let g:vantage_e2e_artifact_path='$(E2E_DIR)/model-all-commands.json'" --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/examples/e2e-codebase/lua/calculator.lua" -c "lua dofile('$(ROOT)/nvim/tests/e2e_all_commands_spec.lua').run()" -c "qa!"
	@cat "$(E2E_DIR)/model-all-commands.json"

test-dev-init: dev-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa

test-dev-init-pi: dev-dirs compile
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --cmd "let g:vantage_dev_agent='pi'" --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa
