# Build and test environment for the PickGak desktop app (Tauri 2, Linux).
# Keeps the developer machine untouched: Rust, WebKitGTK headers and an Xvfb
# test display live only in this image.
FROM fedora:44
RUN dnf -y install --setopt=install_weak_deps=False \
      rust cargo clippy rustfmt gcc gcc-c++ pkgconf-pkg-config \
      webkit2gtk4.1-devel gtk3-devel libsoup3-devel librsvg2-devel \
      libappindicator-gtk3-devel openssl-devel \
      libX11-devel libxcb-devel libXi-devel \
      cmake ninja-build glibc-static libstdc++-static libpng-static zlib-ng-compat-static \
      nodejs npm \
      xorg-x11-server-Xvfb xdotool ImageMagick xwininfo xprop dbus-daemon \
      file rpm-build \
    && dnf clean all
ENV CARGO_HOME=/cargo CARGO_TARGET_DIR=/target
WORKDIR /src
