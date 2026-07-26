# Task 2 Report: AoE2 id→name constant maps

## Files Changed
- Created: `website/aoe2/const.py`
- Modified: `website/tests/test_aoe2.py` (appended 2 new test functions)

## TDD Evidence

### RED — failing test (before const.py existed)
Command:
```
uv run pytest website/tests/test_aoe2.py::test_age_techs -v
```
Output (exit code 4):
```
ERROR collecting website/tests/test_aoe2.py
ImportError: cannot import name 'const' from 'website.aoe2'
```

### GREEN — passing after const.py created
Command:
```
uv run pytest website/tests/test_aoe2.py::test_age_techs website/tests/test_aoe2.py::test_name_helpers_fallback -v
```
Output:
```
website/tests/test_aoe2.py::test_age_techs PASSED
website/tests/test_aoe2.py::test_name_helpers_fallback PASSED
2 passed in 2.73s
```

## Commit
`a0e8376 feat(aoe2): id->name constant maps with fallbacks`

## Concerns
- None. The ruff PostToolUse hook reformatted `const.py` after Write (expected). The pre-existing `import mgz.fast` / `import mgz.fast.header` in `test_aoe2.py` were not touched (still needed for `test_mgz_fast_parses_fixture_header`).

## Fix round 1

### Changes applied
1. Moved `from website.aoe2 import const` to the top of `website/tests/test_aoe2.py`, grouped after stdlib/third-party imports (fixes E402).
2. Removed `30: "Castle"` from `BUILDING_NAMES` in `website/aoe2/const.py` (kept canonical `82: "Castle"`).
3. Removed `46: "Bohemians"` from `CIV_NAMES` in `website/aoe2/const.py` (kept canonical `38: "Bohemians"`).

### pytest result
```
uv run pytest website/tests/test_aoe2.py -v
website/tests/test_aoe2.py::test_age_techs PASSED
website/tests/test_aoe2.py::test_name_helpers_fallback PASSED
2 passed in 2.77s
```

### ruff check result
```
uvx ruff check website/aoe2/const.py website/tests/test_aoe2.py
All checks passed!
```

## Fix round 2 (restore tests)

### Changes applied
Restored the two Task 1 rec-parsing smoke tests (`test_fixture_exists`, `test_mgz_fast_parses_fixture_header`) that were dropped during the dedupe pass. Added `import mgz.fast.header` at the top (required by `test_mgz_fast_parses_fixture_header`).

### pytest result
```
uv run pytest website/tests/test_aoe2.py -v
website/tests/test_aoe2.py::test_fixture_exists PASSED
website/tests/test_aoe2.py::test_mgz_fast_parses_fixture_header PASSED
website/tests/test_aoe2.py::test_age_techs PASSED
website/tests/test_aoe2.py::test_name_helpers_fallback PASSED
4 passed in 1.78s
```

### ruff check result
```
uvx ruff check website/tests/test_aoe2.py
All checks passed!
```
