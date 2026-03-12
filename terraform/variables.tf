variable "project_id" {
  type        = string
  description = "The Google Cloud Project ID"
}

variable "region" {
  type        = string
  description = "GCP region (us-east1 = Moncks Corner, South Carolina)"
  default     = "us-east1"
}

variable "backend_image" {
  type        = string
  description = "Full Docker image URI in Artifact Registry — used for the HTTP API service"
  # Set this via terraform.tfvars or -var flag after building and pushing your image.
  # Example: us-east1-docker.pkg.dev/my-project-id/ai-tutor/backend:latest
  # No default — must be supplied explicitly to avoid accidental stale deployments.
}

variable "agent_image" {
  type        = string
  description = "Full Docker image URI in Artifact Registry — used for the LiveKit agent worker service"
  # Typically the same image as backend_image (same Dockerfile, different CMD).
  # Set this via terraform.tfvars or -var flag.
  # Example: us-east1-docker.pkg.dev/my-project-id/ai-tutor/backend:latest
  # No default — must be supplied explicitly.
}

variable "db_password" {
  type        = string
  description = "Password for the Cloud SQL postgres user (used to create the DB user and build DATABASE_URL)"
  sensitive   = true
}
