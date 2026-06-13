from scripts.audiobook_lib import chunk_paragraphs, clean_pdf_text


def test_clean_dehyphenates_line_breaks():
    raw = "applica-\ntion-level"
    assert clean_pdf_text(raw) == "application-level"


def test_clean_drops_standalone_page_numbers():
    raw = "End of section.\n  42  \nNext section"
    assert "42" not in clean_pdf_text(raw)


def test_clean_collapses_extra_blank_lines():
    raw = "Para one.\n\n\n\nPara two."
    assert clean_pdf_text(raw) == "Para one.\n\nPara two."


def test_clean_em_dash_to_comma():
    raw = "Alpha—beta–gamma"
    cleaned = clean_pdf_text(raw)
    assert "—" not in cleaned
    assert "–" not in cleaned


def test_chunk_respects_max_len():
    text = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five."
    chunks = chunk_paragraphs(text, target_len=20, max_len=40)
    for c in chunks:
        assert len(c) <= 40, c


def test_chunk_keeps_sentences_together_when_possible():
    text = "Short. Longer sentence here."
    chunks = chunk_paragraphs(text, target_len=100, max_len=200)
    assert chunks == ["Short. Longer sentence here."]


def test_chunk_empty_input():
    assert chunk_paragraphs("", target_len=600, max_len=1500) == []
