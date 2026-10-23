# CycloneDX image SBOMs

These inventories describe the local release candidate images scanned on 2026-10-22. The filenames contain the short image digest; the full digests and scan outcomes are recorded in the parent [validation record](../../validation.md).

The backend inventory contains 336 components. The frontend inventory contains 183 components. Generate new files after each release image build and retain them with the corresponding image digests; these files do not describe future builds or published images.

The artifacts were produced with Trivy 0.76.1 using `trivy image --format cyclonedx`. Vulnerability results are in the associated local scan evidence, since the inventory generation command did not embed vulnerability entries.
