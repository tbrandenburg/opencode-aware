.PHONY: install build clean test test-e2e typecheck lint validate publish-check publish publish-patch publish-minor publish-major publish-patch-internal publish-minor-internal publish-major-internal publish-internal

PLUGIN_DIR := opencode-aware

install:
	cd $(PLUGIN_DIR) && bun install
	$(MAKE) build

PLUGIN_OUT := .opencode/plugins/opencode-aware.js

build:
	cd $(PLUGIN_DIR) && bun run build
	bun build $(PLUGIN_DIR)/src/index.ts --outfile $(PLUGIN_OUT) --target bun --format esm

clean:
	rm -rf $(PLUGIN_DIR)/dist

typecheck:
	cd $(PLUGIN_DIR) && bunx tsc --noEmit

test:
	cd $(PLUGIN_DIR) && bun test src/index.test.ts

test-e2e: build
	cd $(PLUGIN_DIR) && bun test src/e2e.test.ts --timeout 90000

lint: typecheck

validate: lint test

# Publishing targets
publish-check:
	@echo "Checking publishing preconditions..."
	@npm whoami > /dev/null || (echo "Not logged into npm. Run 'npm login' first." && exit 1)
	@echo "npm login verified"
	@git status --porcelain | grep -q . && (echo "Working directory not clean. Commit or stash changes first." && exit 1) || echo "Working directory clean"
	@BRANCH=$$(git branch --show-current); \
	if [ "$$BRANCH" != "main" ] && [ "$$BRANCH" != "master" ]; then \
		echo "Not on main/master branch (currently on $$BRANCH)"; \
		exit 1; \
	fi
	@echo "On main/master branch"
	@git fetch origin > /dev/null 2>&1 || true
	@LOCAL=$$(git rev-parse @); \
	REMOTE=$$(git rev-parse @{u} 2>/dev/null || echo ""); \
	if [ "$$REMOTE" != "" ] && [ "$$LOCAL" != "$$REMOTE" ]; then \
		echo "Local branch is not up to date with remote. Pull latest changes first."; \
		exit 1; \
	fi
	@echo "Branch is up to date with remote"
	@echo "All preconditions met!"

# Interactive publish (lets user choose version type)
publish: publish-check validate
	@echo "Starting interactive publish process..."
	@echo "Current version: $$(cd $(PLUGIN_DIR) && node -p 'require("./package.json").version')"
	@echo "Choose version bump type:"
	@echo "  1) patch (bug fixes)"
	@echo "  2) minor (new features)"
	@echo "  3) major (breaking changes)"
	@read -p "Enter choice (1-3): " choice; \
	case $$choice in \
		1) $(MAKE) publish-patch-internal ;; \
		2) $(MAKE) publish-minor-internal ;; \
		3) $(MAKE) publish-major-internal ;; \
		*) echo "Invalid choice. Aborting." && exit 1 ;; \
	esac

# Direct version bump targets
publish-patch: publish-check validate
	$(MAKE) publish-patch-internal

publish-minor: publish-check validate
	$(MAKE) publish-minor-internal

publish-major: publish-check validate
	$(MAKE) publish-major-internal

# Internal publishing logic
publish-patch-internal:
	@echo "Bumping patch version..."
	cd $(PLUGIN_DIR) && npm version patch --no-git-tag-version
	@$(MAKE) publish-internal

publish-minor-internal:
	@echo "Bumping minor version..."
	cd $(PLUGIN_DIR) && npm version minor --no-git-tag-version
	@$(MAKE) publish-internal

publish-major-internal:
	@echo "Bumping major version..."
	cd $(PLUGIN_DIR) && npm version major --no-git-tag-version
	@$(MAKE) publish-internal

publish-internal:
	@cd $(PLUGIN_DIR) && \
	NEW_VERSION=$$(node -p 'require("./package.json").version'); \
	echo "Publishing version $$NEW_VERSION..."; \
	git add package.json; \
	git commit -m "v$$NEW_VERSION"; \
	git tag "v$$NEW_VERSION"; \
	if [ -n "$$NPM_TOKEN" ]; then \
		npm publish --access public "--//registry.npmjs.org/:_authToken=$$NPM_TOKEN"; \
	else \
		npm publish --access public; \
	fi; \
	echo "Pushing commits and tag..."; \
	git push; \
	git push origin --tags; \
	echo "Creating GitHub release..."; \
	if command -v gh >/dev/null 2>&1; then \
		gh release create "v$$NEW_VERSION" --title "v$$NEW_VERSION" --notes "Release v$$NEW_VERSION" --latest; \
	else \
		echo "GitHub CLI (gh) not found. Install it to create releases automatically."; \
	fi; \
	echo "Successfully published $$NEW_VERSION!"
