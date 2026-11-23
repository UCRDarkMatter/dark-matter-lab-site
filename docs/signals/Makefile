# Build the signal-physics explainers. Figures: node figdata.js > /tmp/sfd.json && python3 figures.py /tmp/sfd.json
DOCS = gamma alpha alphan beta cherenkov
all: $(DOCS:=.pdf)
%.pdf: %.tex preamble.tex
	latexmk -pdf -interaction=nonstopmode -halt-on-error $<
figures:
	node figdata.js > /tmp/sfd.json && python3 figures.py /tmp/sfd.json
clean:
	latexmk -c $(DOCS:=.tex)
.PHONY: all figures clean
