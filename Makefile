ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
NVIM ?= nvim
NPM ?= npm
FILE ?= README.md
DEV_HOME := $(ROOT)/.nvim-dev
DEV_ENV := XDG_CONFIG_HOME="$(DEV_HOME)/config" XDG_DATA_HOME="$(DEV_HOME)/data" XDG_STATE_HOME="$(DEV_HOME)/state" XDG_CACHE_HOME="$(DEV_HOME)/cache" LEARN_NVIM_ROOT="$(ROOT)"

.PHONY: test run compile lint dev-dirs

dev-dirs:
	mkdir -p "$(DEV_HOME)/config" "$(DEV_HOME)/data" "$(DEV_HOME)/state" "$(DEV_HOME)/cache"

compile:
	$(NPM) run compile

lint:
	$(NPM) run lint

test: dev-dirs
	$(DEV_ENV) $(NPM) run test:mvp

run: dev-dirs compile
	$(DEV_ENV) $(NVIM) --noplugin -u "$(ROOT)/nvim/dev/init.lua" "$(FILE)"
