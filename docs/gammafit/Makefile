# Rebuild the explainer: figures come from the site's fit engine.
all: gammafit.pdf
figdata.json: figdata.js ../../assets/gammafit-core.js
	node figdata.js > figdata.json
fig/anatomy.pdf: figdata.json figures.py
	python3 figures.py figdata.json
minifit_output.txt: minifit.py
	python3 minifit.py > minifit_output.txt
gammafit.pdf: gammafit.tex fig/anatomy.pdf minifit_output.txt
	latexmk -pdf -interaction=nonstopmode gammafit.tex
clean:
	latexmk -C; rm -f figdata.json
.PHONY: all clean
