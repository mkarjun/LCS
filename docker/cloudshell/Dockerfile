# LCS CloudShell tools image.
#
# One of these runs per CloudShell session. It is never the thing being emulated — it is
# the box the user's shell lives in — so it carries the tools AWS CloudShell ships and
# nothing LCS-specific. Credentials, Region, and the LCS endpoint are injected as
# environment variables at container creation; there is no baked-in configuration.
#
# Build it, and CloudShell picks it up automatically:
#
#   docker build -t lcs/cloudshell:latest -f docker/cloudshell/Dockerfile docker/cloudshell
#
# Without it, LCS falls back to amazon/aws-cli:latest, which has the AWS CLI but none of
# the rest. Override either image with:
#
#   FLOCI_SERVICES_CLOUDSHELL_IMAGE / FLOCI_SERVICES_CLOUDSHELL_FALLBACK_IMAGE

FROM amazonlinux:2023

ARG TERRAFORM_VERSION=1.9.8
ARG KUBECTL_VERSION=1.31.0

# The AWS CLI comes from the official installer rather than the distro package so that the
# shell has CLI v2 — the version the AWS docs assume — not v1.
#
# --allowerasing is required, not defensive: Amazon Linux 2023 ships curl-minimal, and
# installing full curl over it is a package conflict that fails the whole transaction.
RUN set -eux; \
    dnf -y --allowerasing update; \
    dnf -y --allowerasing install \
        bash-completion \
        ca-certificates \
        curl \
        findutils \
        git \
        gzip \
        jq \
        less \
        nano \
        nodejs \
        npm \
        openssh-clients \
        procps-ng \
        python3 \
        python3-pip \
        tar \
        unzip \
        vim-minimal \
        which \
        zip; \
    dnf clean all; \
    rm -rf /var/cache/dnf

RUN set -eux; \
    arch="$(uname -m)"; \
    case "$arch" in \
        x86_64)  awsArch='x86_64'; hashiArch='amd64'; k8sArch='amd64' ;; \
        aarch64) awsArch='aarch64'; hashiArch='arm64'; k8sArch='arm64' ;; \
        *) echo >&2 "unsupported arch: $arch"; exit 1 ;; \
    esac; \
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${awsArch}.zip" -o /tmp/awscli.zip; \
    unzip -q /tmp/awscli.zip -d /tmp; \
    /tmp/aws/install; \
    rm -rf /tmp/aws /tmp/awscli.zip; \
    curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${hashiArch}.zip" -o /tmp/terraform.zip; \
    unzip -q /tmp/terraform.zip -d /usr/local/bin; \
    rm -f /tmp/terraform.zip; \
    curl -fsSL "https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/${k8sArch}/kubectl" -o /usr/local/bin/kubectl; \
    chmod +x /usr/local/bin/kubectl; \
    pip3 install --no-cache-dir boto3

# The home directory is a mount point: LCS mounts a per-account, per-Region Docker volume
# here, so files a user leaves behind survive session restarts.
RUN mkdir -p /home/cloudshell-user

# The AWS CLI's pager traps a user who does not know to press q; AWS CloudShell disables it
# too. The prompt matches AWS's shape without claiming to be a real EC2 host.
RUN printf '%s\n' \
    'export AWS_PAGER=' \
    'export PS1="[\u@lcs \W]\$ "' \
    '[ -f /usr/share/bash-completion/bash_completion ] && . /usr/share/bash-completion/bash_completion' \
    'complete -C "$(command -v aws_completer)" aws 2>/dev/null || true' \
    > /etc/profile.d/lcs-cloudshell.sh

WORKDIR /home/cloudshell-user

# LCS overrides both at container creation — the container idles and is exec'd into. This
# only keeps the image runnable on its own.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["while true; do sleep 3600; done"]
