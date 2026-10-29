#include <jni.h>
#include <cstring>
#include <string>

extern "C" {
int td_create_client_id();
void td_send(int client_id, const char *request);
const char *td_receive(double timeout);
}

extern "C" JNIEXPORT jint JNICALL
Java_app_halo_mobile_HaloTdlibPlugin_nativeCreateClient(JNIEnv *, jclass) {
    return td_create_client_id();
}

extern "C" JNIEXPORT void JNICALL
Java_app_halo_mobile_HaloTdlibPlugin_nativeSend(JNIEnv *env, jclass, jint client_id, jbyteArray request) {
    jsize length = env->GetArrayLength(request);
    std::string text(static_cast<size_t>(length), '\0');
    env->GetByteArrayRegion(request, 0, length, reinterpret_cast<jbyte *>(text.data()));
    td_send(client_id, text.c_str());
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_halo_mobile_HaloTdlibPlugin_nativeReceive(JNIEnv *env, jclass, jdouble timeout) {
    const char *result = td_receive(timeout);
    if (result == nullptr) return nullptr;
    jsize length = static_cast<jsize>(std::strlen(result));
    jbyteArray output = env->NewByteArray(length);
    if (output != nullptr) env->SetByteArrayRegion(output, 0, length, reinterpret_cast<const jbyte *>(result));
    return output;
}
