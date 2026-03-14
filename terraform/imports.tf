# ─── Idempotent imports ───────────────────────────────────────────────────────
# These import blocks make terraform apply self-healing: if the VPC or global
# address already exist in GCP but not in state (e.g. after a partial destroy),
# Terraform will import them automatically instead of failing with 409 Conflict.
# Safe to leave in permanently — Terraform ignores them when the resource is
# already in state.

import {
  id = "projects/${var.project_id}/global/networks/ai-tutor-vpc"
  to = google_compute_network.main
}

import {
  id = "projects/${var.project_id}/global/addresses/ai-tutor-private-ip"
  to = google_compute_global_address.private_ip_alloc
}
