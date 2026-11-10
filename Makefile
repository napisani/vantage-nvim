ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
NVIM ?= nvim
NPM ?= mise exec -- npm
FILE ?= README.md
DEV_HOME := $(ROOT)/.nvim-dev
DEV_ENV := XDG_CONFIG_HOME="$(DEV_HOME)/config" XDG_DATA_HOME="$(DEV_HOME)/data" XDG_STATE_HOME="$(DEV_HOME)/state" XDG_CACHE_HOME="$(DEV_HOME)/cache"
DEV_ROOT := --cmd "let g:vantage_nvim_root='$(ROOT)'"

.PHONY: check test test-ext test-nvim typecheck lint run dev-dirs

dev-dirs:
	mkdir -p "$(DEV_HOME)/config" "$(DEV_HOME)/data" "$(DEV_HOME)/state" "$(DEV_HOME)/cache"

check:
	$(NPM) run check

typecheck:
	$(NPM) run typecheck

lint:
	$(NPM) run lint

test-ext:
	$(NPM) run test:ext

test-nvim: dev-dirs
	$(DEV_ENV) $(NPM) run test:nvim

test: test-ext test-nvim

# A Neovim with only this plugin loaded. Start `pi` in the same workspace with
# the pi-vantage-nvim extension installed to have something to talk to.
run: dev-dirs
	$(DEV_ENV) $(NVIM) $(DEV_ROOT) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"
