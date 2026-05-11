ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
NVIM ?= nvim
NPM ?= npm
FILE ?= README.md
DEV_HOME := $(ROOT)/.nvim-dev
DEV_ENV := XDG_CONFIG_HOME="$(DEV_HOME)/config" XDG_DATA_HOME="$(DEV_HOME)/data" XDG_STATE_HOME="$(DEV_HOME)/state" XDG_CACHE_HOME="$(DEV_HOME)/cache" LEARN_NVIM_ROOT="$(ROOT)"
CODEX_MODEL ?= gpt-5.4-mini
CODEX_COMMAND ?= codex

.PHONY: test run run-codex compile lint test-dev-init test-dev-init-codex dev-dirs

dev-dirs:
	mkdir -p "$(DEV_HOME)/config" "$(DEV_HOME)/data" "$(DEV_HOME)/state" "$(DEV_HOME)/cache"

compile:
	$(NPM) run compile

lint:
	$(NPM) run lint

test: dev-dirs test-dev-init test-dev-init-codex
	$(DEV_ENV) $(NPM) run test:mvp

run: dev-dirs compile
	$(DEV_ENV) $(NVIM) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

run-codex: dev-dirs compile
	$(DEV_ENV) LEARN_DEV_PROVIDER=codex LEARN_PROVIDER=codex LEARN_CODEX_MODEL="$(CODEX_MODEL)" LEARN_CODEX_COMMAND="$(CODEX_COMMAND)" $(NVIM) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"

test-dev-init: dev-dirs compile
	$(DEV_ENV) $(NVIM) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa

test-dev-init-codex: dev-dirs compile
	$(DEV_ENV) LEARN_DEV_PROVIDER=codex $(NVIM) --headless --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(ROOT)/README.md" -c "lua dofile('$(ROOT)/nvim/tests/dev_init_spec.lua').run()" -c qa
