import Capacitor

class HaloBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HaloTdlibPlugin())
    }
}
