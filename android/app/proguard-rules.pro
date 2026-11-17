# SPDX-License-Identifier: Apache-2.0
# R8 rules for the release build (minify + resource shrinking).
# Components named in AndroidManifest.xml (activities, receivers, services, the device admin
# receiver) are kept by AAPT's generated rules; WorkManager keeps its Worker classes itself
# (the class name is stored in WorkManager's database, so an update finds queued work).

# Enum names are written to storage (contacts/BlockedLog.kt) and read back with valueOf.
-keepclassmembers enum org.plainphone.app.** {
    <fields>;
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Readable stack traces in bug reports: keep file and line numbers, hide the original file name.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
