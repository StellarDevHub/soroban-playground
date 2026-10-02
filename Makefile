.PHONY: install dev build test build-wasm check-wasm-size clean

WASM_TARGET? wasm32-unknown-unknown
WASM_OUT? app.wasm
WASM_MAX_SIZE_KB? 64

install:
	npm install

dev:
	npm run dev

build:
	npm run build

test:
	npm run test

build-wasm:
	cargo build --target $(WASM_TARGET) --release
	@ $(call check-wasm-size)

check-wasm-size:
	@ size=$$(du -k $(WASM_OUT) | cut -f1); \
	echo "WASM size: $${size} KB"; \
	if [ $$size -gt $(WASM_MAX_SIZE_KB)  ]; then \
		echo "ERROR: WASM binary exceeds $(WASM_MAX_SIZE_KB) KB limit" >&2; \
		exit 1; \
	fi

clean:
	cargo clean
	rm -rf dist node_modules
