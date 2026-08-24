packer {
  required_version = "= 1.16.0"
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = "= 1.8.2"
    }
  }
}

variable "region" {
  type = string
  validation {
    condition     = can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$", var.region))
    error_message = "Region must be an AWS region identifier."
  }
}

variable "source_ami_id" {
  type = string
  validation {
    condition     = can(regex("^ami-[0-9a-f]+$", var.source_ami_id))
    error_message = "Source AMI ID must be a pinned AMI ID."
  }
}

variable "debian_snapshot" {
  type = string
  validation {
    condition     = can(regex("^20[0-9]{6}T[0-9]{6}Z$", var.debian_snapshot))
    error_message = "Debian snapshot must use YYYYMMDDTHHMMSSZ."
  }
}

variable "vpc_id" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "security_group_id" {
  type = string
}

variable "iam_instance_profile" {
  type = string
}

variable "ssh_username" {
  type    = string
  default = "admin"
}

variable "build_instance_type" {
  type    = string
  default = "m7i.large"
}

variable "root_volume_size_gib" {
  type    = number
  default = 30
}

variable "artifact_directory" {
  type = string
}

variable "source_commit" {
  type = string
  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.source_commit))
    error_message = "Source commit must be a full Git SHA."
  }
}

variable "briar_version" {
  type = string
}

variable "ssm_agent_version" {
  type = string
}

variable "ssm_agent_sha256" {
  type = string
}

variable "packer_manifest_path" {
  type = string
}

variable "package_lock_output" {
  type = string
}

variable "image_manifest_output" {
  type = string
}

source "amazon-ebs" "managed_computer" {
  region                      = var.region
  source_ami                  = var.source_ami_id
  instance_type               = var.build_instance_type
  vpc_id                      = var.vpc_id
  subnet_id                   = var.subnet_id
  security_group_id           = var.security_group_id
  associate_public_ip_address = false
  iam_instance_profile        = var.iam_instance_profile

  communicator  = "ssh"
  ssh_username  = var.ssh_username
  ssh_interface = "session_manager"
  ssh_timeout   = "20m"

  ami_name        = "briar-managed-debian13-${var.briar_version}-{{timestamp}}"
  ami_description = "Briar managed computer Debian 13 ${var.briar_version} (${var.source_commit})"
  imds_support    = "v2.0"

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  launch_block_device_mappings {
    device_name           = "/dev/xvda"
    delete_on_termination = true
    encrypted             = true
    volume_size           = var.root_volume_size_gib
    volume_type           = "gp3"
  }

  user_data = templatefile(abspath("${path.root}/bootstrap-ssm.sh.tftpl"), {
    region          = var.region
    debian_snapshot = var.debian_snapshot
    ssm_version     = var.ssm_agent_version
    ssm_sha256      = var.ssm_agent_sha256
  })

  run_tags = {
    Name          = "briar-managed-image-builder"
    briar-managed = "image-builder"
    SourceCommit  = var.source_commit
  }

  tags = {
    Name            = "briar-managed-debian13-${var.briar_version}"
    briar-managed   = "true"
    OperatingSystem = "debian-13"
    Architecture    = "x86_64"
    SourceAmiId     = var.source_ami_id
    SourceCommit    = var.source_commit
    BriarVersion    = var.briar_version
  }
}

build {
  name    = "briar-managed-computer"
  sources = ["source.amazon-ebs.managed_computer"]

  provisioner "file" {
    source      = "${var.artifact_directory}/"
    destination = "/tmp/briar-image"
  }

  provisioner "shell" {
    inline = [
      "chmod +x /tmp/briar-image/install-image-runtime",
      "sudo env AWS_REGION='${var.region}' BRIAR_BASE_AMI_ID='${var.source_ami_id}' /tmp/briar-image/install-image-runtime /tmp/briar-image"
    ]
  }

  provisioner "file" {
    direction   = "download"
    source      = "/opt/briar/remote-desktop-packages.lock"
    destination = var.package_lock_output
  }

  provisioner "file" {
    direction   = "download"
    source      = "/opt/briar/image-manifest.json"
    destination = var.image_manifest_output
  }

  provisioner "shell" {
    inline = [
      "sudo env BRIAR_BASE_AMI_ID='${var.source_ami_id}' /opt/briar/bin/verify-managed-image",
      "sudo /opt/briar/bin/prepare-image-for-capture",
      "sudo /opt/briar/bin/verify-managed-image --capture-ready"
    ]
  }

  post-processor "manifest" {
    output     = var.packer_manifest_path
    strip_path = true
    custom_data = {
      base_ami_id   = var.source_ami_id
      briar_version = var.briar_version
      source_commit = var.source_commit
    }
  }
}
