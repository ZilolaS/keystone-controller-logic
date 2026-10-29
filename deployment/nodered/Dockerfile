FROM csedgeplatform.azurecr.io/noderedmodule@sha256:3c060e5784990b45880f159040f3c5ca933c38f2dfcdf57d7d914330d61107bf

USER root
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
LABEL org.opencontainers.image.version="3.0.23"
COPY dist/ /data-internal/dist/
COPY flows/unified_platform_runtime_flow.json /data-internal/flows/unified_platform_runtime_flow.json
COPY scripts/apply-node-red-fixed-slots.py /data-internal/scripts/apply-node-red-fixed-slots.py
COPY deployment/nodered/user-authentication.js /data-internal/user-authentication.js
