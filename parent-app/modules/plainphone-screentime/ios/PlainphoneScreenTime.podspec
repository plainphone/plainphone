# SPDX-License-Identifier: Apache-2.0
# Local Expo module (autolinked from parent-app/modules). Core/ is shared with the extension
# targets and unit tested through the xcodegen project in ios/ (docs/ios/architecture.md).
Pod::Spec.new do |s|
  s.name           = 'PlainphoneScreenTime'
  s.version        = '0.1.0'
  s.summary        = 'Family Controls, ManagedSettings and DeviceActivity for the Plainphone iPhone app'
  s.license        = 'Apache-2.0'
  s.author         = 'Plainphone'
  s.homepage       = 'https://plainphone.org'
  # The Parent role runs where Expo runs; the Child role checks iOS 26 at run time.
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/plainphone/plainphone.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'FamilyControls', 'ManagedSettings', 'DeviceActivity'

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
