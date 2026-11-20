FROM python:3.11-slim-bookworm@sha256:a83ba18aef0f865b1a4a611c2cf460fe446f2795673bbb9fe43be570439e3b39
ADD --checksum=sha256:5d45a3bf09e9568df76cc2e06cf9350199198bffea18e9e2f0d9d7828698146c https://codeload.github.com/apple-aiml-research/ToolSandbox/tar.gz/c8571d7854316d2e1c5f288e59fe1e34e53f6dd1 /tmp/toolsandbox.tar.gz
COPY requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/requirements.txt \
    && python -m pip install --no-cache-dir --no-deps /tmp/toolsandbox.tar.gz \
    && rm -f /tmp/toolsandbox.tar.gz \
    && install -d -m 0770 -o 65534 -g 65534 /socket
COPY grade.py /opt/toolsandbox/grade.py
ENV TZ=UTC POLARS_MAX_THREADS=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
USER 65534:65534
ENTRYPOINT ["python", "-I", "-B", "/opt/toolsandbox/grade.py"]
