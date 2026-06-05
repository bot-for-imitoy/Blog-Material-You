---
title: LaTeX Math Rendering Test
date: 2026-05-31
tags: [latex, math, test]
categories: [Tech]
title_en: English Title Test
tags_en: [en-tag1, en-tag2]
categories_en: [en-cat]
content_en: English content body here
---

This post tests LaTeX math rendering with KaTeX.

## Inline Math

The quadratic formula: $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$

Euler's identity: $e^{i\pi} + 1 = 0$

## Display Math

Maxwell's equations:

$$
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}
$$

$$
\nabla \cdot \mathbf{B} = 0
$$

$$
\nabla \times \mathbf{E} = -\frac{\partial \mathbf{B}}{\partial t}
$$

$$
\nabla \times \mathbf{B} = \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
$$

## More Complex Math

The Gaussian integral:

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

The Schrödinger equation:

$$
i\hbar \frac{\partial}{\partial t}|\Psi(t)\rangle = \hat{H}|\Psi(t)\rangle
$$

Einstein's field equations:

$$
R_{\mu\nu} - \frac{1}{2}R g_{\mu\nu} + \Lambda g_{\mu\nu} = \frac{8\pi G}{c^4} T_{\mu\nu}
$$

## Inline with text

When we consider the function $f(x) = \int_0^x e^{-t^2} dt$, we find that $\lim_{x \to \infty} f(x) = \frac{\sqrt{\pi}}{2}$.

Summation: $\sum_{k=1}^n k = \frac{n(n+1)}{2}$

Matrix: $\begin{pmatrix} a & b \\ c & d \end{pmatrix}$
