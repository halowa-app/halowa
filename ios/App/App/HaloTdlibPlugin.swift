import Capacitor
import Darwin
import Foundation

private typealias TdCreate = @convention(c) () -> Int32
private typealias TdSend = @convention(c) (Int32, UnsafePointer<CChar>?) -> Void
private typealias TdReceive = @convention(c) (Double) -> UnsafePointer<CChar>?

private struct TdFunctions {
    let create: TdCreate
    let send: TdSend
    let receive: TdReceive

    static func load() -> TdFunctions? {
        let paths = [
            Bundle.main.privateFrameworksPath.map { "\($0)/tdjson.framework/tdjson" },
            Bundle.main.path(forResource: "libtdjson", ofType: "dylib"),
        ].compactMap { $0 }
        let handles = [dlopen(nil, RTLD_NOW)] + paths.map { dlopen($0, RTLD_NOW) }
        for handle in handles {
            guard let handle,
                  let createSymbol = dlsym(handle, "td_create_client_id"),
                  let sendSymbol = dlsym(handle, "td_send"),
                  let receiveSymbol = dlsym(handle, "td_receive") else { continue }
            return TdFunctions(
                create: unsafeBitCast(createSymbol, to: TdCreate.self),
                send: unsafeBitCast(sendSymbol, to: TdSend.self),
                receive: unsafeBitCast(receiveSymbol, to: TdReceive.self)
            )
        }
        return nil
    }
}

@objc(HaloTdlibPlugin)
public class HaloTdlibPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HaloTdlibPlugin"
    public let jsName = "HaloTdlib"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
    ]

    private let functions = TdFunctions.load()
    private let lock = NSLock()
    private let receiverQueue = DispatchQueue(label: "app.halo.tdlib.receiver", qos: .userInitiated)
    private var pending: [String: CAPPluginCall] = [:]
    private var clientId: Int32 = 0
    private var receiving = false

    @objc public func status(_ call: CAPPluginCall) {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("tdlib", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        lock.lock()
        let ready = clientId != 0 && receiving
        lock.unlock()
        call.resolve(["available": functions != nil, "ready": ready, "databaseDirectory": directory.path])
    }

    @objc public func start(_ call: CAPPluginCall) {
        guard let functions else {
            call.reject("TDLib binaries are not installed in this iOS build.")
            return
        }
        lock.lock()
        if clientId == 0 {
            clientId = functions.create()
            receiving = clientId != 0
            receiverQueue.async { [weak self] in self?.receiveLoop() }
        }
        let ready = receiving
        lock.unlock()
        call.resolve(["ready": ready])
    }

    @objc public func send(_ call: CAPPluginCall) {
        guard let functions, var request = call.getObject("request"),
              let type = request["@type"] as? String, !type.isEmpty else {
            call.reject("A TDLib request with @type is required.")
            return
        }
        lock.lock()
        let id = clientId
        let active = receiving
        lock.unlock()
        guard id != 0 && active else {
            call.reject("TDLib is not started.")
            return
        }
        let token = UUID().uuidString
        request["@extra"] = token
        guard let data = try? JSONSerialization.data(withJSONObject: request),
              let text = String(data: data, encoding: .utf8) else {
            call.reject("Invalid TDLib request.")
            return
        }
        lock.lock()
        pending[token] = call
        lock.unlock()
        text.withCString { functions.send(id, $0) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let expired = self.pending.removeValue(forKey: token)
            self.lock.unlock()
            expired?.reject("TDLib request timed out.")
        }
    }

    private func receiveLoop() {
        guard let functions else { return }
        while true {
            lock.lock()
            let active = receiving
            let id = clientId
            lock.unlock()
            if !active { return }
            guard let pointer = functions.receive(1.0) else { continue }
            let data = Data(String(cString: pointer).utf8)
            guard let response = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  (response["@client_id"] as? Int32 ?? id) == id else { continue }
            if let token = response["@extra"] as? String {
                lock.lock()
                let call = pending.removeValue(forKey: token)
                lock.unlock()
                if let call {
                    DispatchQueue.main.async {
                        if response["@type"] as? String == "error" {
                            call.reject(response["message"] as? String ?? "TDLib error")
                        } else {
                            call.resolve(["result": response])
                        }
                    }
                }
            } else {
                DispatchQueue.main.async { self.notifyListeners("update", data: response) }
            }
            if response["@type"] as? String == "updateAuthorizationState",
               let state = response["authorization_state"] as? [String: Any],
               state["@type"] as? String == "authorizationStateClosed" {
                lock.lock()
                receiving = false
                clientId = 0
                lock.unlock()
            }
        }
    }
}
