output "backend_url" {
  value       = google_cloud_run_v2_service.backend.uri
  description = "Backend API URL — set as VITE_API_URL in your frontend build"
}

output "agent_vm_ip" {
  value       = google_compute_instance.agent_vm.network_interface[0].access_config[0].nat_ip
  description = "Public IP address of the LiveKit Agent VM (for SSH/Debugging if needed)"
}

output "artifact_registry_hostname" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/ai-tutor"
  description = "Artifact Registry prefix for docker push/pull commands"
}

output "database_connection_name" {
  value       = google_sql_database_instance.main.connection_name
  description = "Cloud SQL connection name (format: project:region:instance)"
}

output "database_public_ip" {
  value       = google_sql_database_instance.main.public_ip_address
  description = "Cloud SQL public IP — used to run schema migrations via Cloud SQL Proxy"
}
