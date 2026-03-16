terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.9"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ─── Required GCP APIs ────────────────────────────────────────────────────────

resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "sql" {
  service            = "sqladmin.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "compute" {
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "servicenetworking" {
  service            = "servicenetworking.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "firebase" {
  service            = "firebase.googleapis.com"
  disable_on_destroy = false
}

# ─── VPC & Private Networking (For Cloud SQL -> VM) ───────────────────────────

# GCP's Service Networking API takes 60-90s to fully propagate after being
# enabled in a brand-new project. Without this wait, the peering connection
# fails with a 403 even though the API resource shows as created in Terraform.
resource "time_sleep" "wait_for_apis" {
  create_duration = "90s"
  depends_on = [
    google_project_service.compute,
    google_project_service.servicenetworking,
    google_project_service.sql,
  ]
}

resource "google_compute_network" "main" {
  name                    = "ai-tutor-vpc"
  auto_create_subnetworks = true
  depends_on              = [time_sleep.wait_for_apis]
}

resource "google_compute_global_address" "private_ip_alloc" {
  name          = "ai-tutor-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_alloc.name]
  depends_on              = [time_sleep.wait_for_apis]
}

# ─── Artifact Registry ────────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "main" {
  depends_on    = [google_project_service.artifactregistry]
  location      = var.region
  repository_id = "ai-tutor"
  format        = "DOCKER"
  description   = "AI Tutor backend Docker images"
}

# ─── Service Accounts ────────────────────────────────────────────────────────

# 1. Service Account for Cloud Run (Backend API)
resource "google_service_account" "cloud_run_sa" {
  account_id   = "ai-tutor-cloudrun"
  display_name = "AI Tutor Cloud Run Service Account"
}

# 2. Service Account for Compute Engine (LiveKit Agent)
resource "google_service_account" "compute_sa" {
  account_id   = "ai-tutor-vm"
  display_name = "AI Tutor VM Service Account"
}

# Shared Roles
resource "google_project_iam_member" "sa_sql_cloudrun" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}
resource "google_project_iam_member" "sa_sql_compute" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.compute_sa.email}"
}

resource "google_project_iam_member" "sa_secrets_cloudrun" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}
resource "google_project_iam_member" "sa_secrets_compute" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.compute_sa.email}"
}

resource "google_project_iam_member" "sa_artifact" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.compute_sa.email}"
}

# Firebase Admin SDK access for Cloud Run Backend
resource "google_project_iam_member" "sa_firebase" {
  project = var.project_id
  role    = "roles/firebase.viewer"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# ─── Cloud SQL (PostgreSQL 18) ────────────────────────────────────────────────

resource "random_id" "db_suffix" {
  byte_length = 4
}

resource "google_sql_database_instance" "main" {
  depends_on = [
    google_service_networking_connection.private_vpc_connection,
    google_project_service.sql,
  ]
  name             = "ai-tutor-db-${random_id.db_suffix.hex}"
  database_version = "POSTGRES_18"
  region           = var.region

  settings {
    tier = "db-f1-micro"
    ip_configuration {
      ipv4_enabled    = true
      private_network = google_compute_network.main.id
    }
  }

  deletion_protection = false
}

resource "google_sql_database" "main" {
  name     = "ai-tutor-db"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "postgres" {
  name     = "postgres"
  instance = google_sql_database_instance.main.name
  password = var.db_password
}

# ─── Secret Manager w/ Initial Dummy Values ───────────────────────────────────

# We must initialize the secrets with dummy values! Cloud Run refuses to deploy
# if we reference a secret that doesn't have a 'latest' version created yet.
variable "dummy_secret_value" {
  default = "update_me_later"
}

resource "google_secret_manager_secret" "livekit_api_key" {
  depends_on = [google_project_service.secretmanager]
  secret_id  = "livekit-api-key"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "livekit_api_key" {
  secret      = google_secret_manager_secret.livekit_api_key.id
  secret_data = var.dummy_secret_value
}

resource "google_secret_manager_secret" "livekit_api_secret" {
  depends_on = [google_project_service.secretmanager]
  secret_id  = "livekit-api-secret"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "livekit_api_secret" {
  secret      = google_secret_manager_secret.livekit_api_secret.id
  secret_data = var.dummy_secret_value
}

resource "google_secret_manager_secret" "livekit_url" {
  depends_on = [google_project_service.secretmanager]
  secret_id  = "livekit-url"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "livekit_url" {
  secret      = google_secret_manager_secret.livekit_url.id
  secret_data = var.dummy_secret_value
}

resource "google_secret_manager_secret" "gemini_api_key" {
  depends_on = [google_project_service.secretmanager]
  secret_id  = "gemini-api-key"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "gemini_api_key" {
  secret      = google_secret_manager_secret.gemini_api_key.id
  secret_data = var.dummy_secret_value
}

resource "google_secret_manager_secret" "azure_translate_key" {
  depends_on = [google_project_service.secretmanager]
  secret_id  = "azure-translate-key"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "azure_translate_key" {
  secret      = google_secret_manager_secret.azure_translate_key.id
  secret_data = var.dummy_secret_value
}

resource "google_secret_manager_secret" "azure_translate_endpoint" {
  depends_on = [google_project_service.secretmanager]
  secret_id  = "azure-translate-endpoint"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "azure_translate_endpoint" {
  secret      = google_secret_manager_secret.azure_translate_endpoint.id
  secret_data = var.dummy_secret_value
}

resource "google_secret_manager_secret" "azure_translate_region" {
  depends_on = [google_project_service.secretmanager]
  secret_id  = "azure-translate-region"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "azure_translate_region" {
  secret      = google_secret_manager_secret.azure_translate_region.id
  secret_data = var.dummy_secret_value
}

# ─── Shared Locals ────────────────────────────────────────────────────────────

locals {
  # Cloud Run Backend utilizes Unix socket connection
  db_socket_url = nonsensitive("postgresql://postgres:${var.db_password}@localhost/ai-tutor-db?host=/cloudsql/${google_sql_database_instance.main.connection_name}")

  # Compute Engine VM utilizes Private IP connection
  db_private_url = nonsensitive("postgresql://postgres:${var.db_password}@${google_sql_database_instance.main.private_ip_address}:5432/ai-tutor-db")
}

# ─── Cloud Run: Backend API ───────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "backend" {
  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_version.livekit_url,
    google_secret_manager_secret_version.livekit_api_key,
    google_secret_manager_secret_version.livekit_api_secret,
    google_secret_manager_secret_version.gemini_api_key,
    google_secret_manager_secret_version.azure_translate_key,
    google_secret_manager_secret_version.azure_translate_endpoint,
    google_secret_manager_secret_version.azure_translate_region
  ]
  name     = "ai-tutor-backend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cloud_run_sa.email

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    containers {
      image = var.backend_image

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "DATABASE_URL"
        value = local.db_socket_url
      }

      env {
        name = "LIVEKIT_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.livekit_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "LIVEKIT_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.livekit_api_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "LIVEKIT_API_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.livekit_api_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_api_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "AZURE_TRANSLATE_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.azure_translate_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "AZURE_TRANSLATE_ENDPOINT"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.azure_translate_endpoint.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "AZURE_TRANSLATE_REGION"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.azure_translate_region.secret_id
            version = "latest"
          }
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "backend_noauth" {
  project  = var.project_id
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── Compute Engine: LiveKit Agent VM ─────────────────────────────────────────

data "google_compute_image" "debian_image" {
  family  = "debian-12"
  project = "debian-cloud"
}

data "google_compute_zones" "available" {
  region = var.region
}

resource "google_compute_instance" "agent_vm" {
  depends_on = [
    google_compute_network.main,
    google_sql_database_instance.main,
  ]
  name         = "ai-tutor-vm"
  machine_type = "e2-medium"
  zone         = data.google_compute_zones.available.names[0]

  boot_disk {
    initialize_params {
      image = data.google_compute_image.debian_image.self_link
    }
  }

  network_interface {
    network = google_compute_network.main.name
    access_config {}
  }

  metadata = {
    startup-script = <<-EOT
      #!/bin/bash
      set -euo pipefail
      exec >> /var/log/agent-startup.log 2>&1
      echo "=== Agent startup: $(date) ==="

      # Install Docker and gcloud SDK (skipped on reboot if already present)
      if ! command -v docker &>/dev/null; then
        apt-get update -qq
        apt-get install -y -qq apt-transport-https ca-certificates curl gnupg

        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list

        curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /etc/apt/keyrings/cloud.google.gpg
        echo "deb [signed-by=/etc/apt/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list

        apt-get update -qq
        apt-get install -y -qq docker-ce docker-ce-cli containerd.io google-cloud-cli

        systemctl enable docker
      fi

      systemctl start docker

      echo "Authenticating Docker to Artifact Registry..."
      gcloud auth configure-docker ${var.region}-docker.pkg.dev --quiet

      echo "Fetching secrets from Secret Manager..."
      # Write each line individually to avoid heredoc indentation issues
      LIVEKIT_URL_VAL=$(gcloud secrets versions access latest --secret=livekit-url --project=${var.project_id})
      LIVEKIT_API_KEY_VAL=$(gcloud secrets versions access latest --secret=livekit-api-key --project=${var.project_id})
      LIVEKIT_API_SECRET_VAL=$(gcloud secrets versions access latest --secret=livekit-api-secret --project=${var.project_id})
      GEMINI_API_KEY_VAL=$(gcloud secrets versions access latest --secret=gemini-api-key --project=${var.project_id})
      AZURE_ENDPOINT_VAL=$(gcloud secrets versions access latest --secret=azure-translate-endpoint --project=${var.project_id} 2>/dev/null || echo mock)
      AZURE_REGION_VAL=$(gcloud secrets versions access latest --secret=azure-translate-region --project=${var.project_id} 2>/dev/null || echo mock)
      AZURE_KEY_VAL=$(gcloud secrets versions access latest --secret=azure-translate-key --project=${var.project_id} 2>/dev/null || echo mock)

      cat > /etc/agent.env <<EOF
NODE_ENV=production
GOOGLE_CLOUD_PROJECT=${var.project_id}
DATABASE_URL=${local.db_private_url}
LIVEKIT_URL=$LIVEKIT_URL_VAL
LIVEKIT_API_KEY=$LIVEKIT_API_KEY_VAL
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET_VAL
GEMINI_API_KEY=$GEMINI_API_KEY_VAL
AZURE_TRANSLATE_ENDPOINT=$AZURE_ENDPOINT_VAL
AZURE_TRANSLATE_REGION=$AZURE_REGION_VAL
AZURE_TRANSLATE_KEY=$AZURE_KEY_VAL
EOF
      chmod 600 /etc/agent.env

      echo "Pulling agent image..."
      docker pull ${var.agent_image}

      echo "Starting agent container..."
      docker rm -f agent-worker 2>/dev/null || true
      docker run -d \
        --name agent-worker \
        --restart unless-stopped \
        --env-file /etc/agent.env \
        ${var.agent_image} \
        node dist/agent.js start

      echo "=== Startup complete: $(date) ==="
    EOT
  }

  service_account {
    email  = google_service_account.compute_sa.email
    scopes = ["cloud-platform"]
  }
}
