CARGO ?= cargo

.PHONY: build test fmt check

build:
	$(CARGO) build --target wasm32-unknown-unknown --release

test:
	$(CARGO) test

fmt:
	$(CARGO) fmt

check:
	$(CARGO) check
