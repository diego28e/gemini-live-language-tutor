terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Cloud SQL Instance (PostgreSQL)
resource "google_sql_database_instance" "main" {
  name             = "ai-tutor-db-instance"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier = "db-f1-micro"
  }
  deletion_protection = false # For hackathon purposes
}

resource "google_sql_database" "database" {
  name     = "ai-tutor-db"
  instance = google_sql_database_instance.main.name
}

# Cloud Run Service (Backend)
resource "google_cloud_run_v2_service" "backend" {
  name     = "ai-tutor-backend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = var.backend_image # Placeholder for the deployed container
      env {
        name  = "DATABASE_URL"
        value = "postgresql://user:pass@${google_sql_database_instance.main.public_ip_address}:5432/ai-tutor-db"
      }
    }
  }
}

# Allow unauthenticated access for the hackathon (Firebase auth handled inside the app)
resource "google_cloud_run_service_iam_member" "noauth" {
  project  = var.project_id
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Secret Manager setup
resource "google_secret_manager_secret" "livekit_api_key" {
  secret_id = "livekit-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "livekit_api_secret" {
  secret_id = "livekit-api-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "gemini-api-key"
  replication {
    auto {}
  }
}
