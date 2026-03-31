#!/usr/bin/env bash
# deploy/pm2-startup.sh
# Configures PM2 to survive macOS reboots
#
# Prerequisites: PM2 installed globally (npm install -g pm2)
# Usage: bash deploy/pm2-startup.sh

set -euo pipefail

echo "Configuring PM2 startup for macOS..."

# Generate and install launchd plist for macOS
pm2 startup launchd

# Save current process list so PM2 restores on reboot
pm2 save

echo "PM2 startup configured. Service will survive reboots."
