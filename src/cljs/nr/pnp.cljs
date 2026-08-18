(ns nr.pnp
  (:require
   [goog.object :as gobj]
   [nr.appstate :refer [app-state]]
   [nr.utils :refer [non-game-toast]]))

(def ^:private jspdf-path "/lib/js/pnp/jspdf.umd.min.js")
(def ^:private engine-path "/lib/js/pnp/pnp-engine.js")
(def ^:private worker-path "/lib/js/pnp/image-worker.js")

(defonce ^:private loader-promise (atom nil))

(defn- pnp-engine []
  (gobj/get js/window "JintekiPnPEngine"))

(defn- jspdf-loaded? []
  (some? (some-> (gobj/get js/window "jspdf")
                 (gobj/get "jsPDF"))))

(defn- versioned-url [path]
  (if-let [version (:app-version @app-state)]
    (str path "?v=" (js/encodeURIComponent version))
    path))

(defn- load-script! [path]
  (js/Promise.
   (fn [resolve reject]
     (let [script (.createElement js/document "script")]
       (set! (.-src script) (versioned-url path))
       (set! (.-async script) false)
       (set! (.-onload script) (fn [] (resolve true)))
       (set! (.-onerror script)
             (fn [] (reject (js/Error. (str "Unable to load " path)))))
       (.appendChild (or (.-head js/document) (.-documentElement js/document)) script)))))

(defn- ensure-engine! []
  (or @loader-promise
      (let [loading (-> (if (jspdf-loaded?)
                          (js/Promise.resolve true)
                          (load-script! jspdf-path))
                        (.then (fn []
                                 (if (some? (pnp-engine))
                                   true
                                   (load-script! engine-path))))
                        (.catch (fn [error]
                                  (reset! loader-promise nil)
                                  (throw error))))]
        (reset! loader-promise loading)
        loading)))

(defn- option-name [value fallback]
  (cond
    (keyword? value) (name value)
    (string? value) value
    :else fallback))

(defn- printable-deck [deck]
  {:name (:name deck)
   :identity (:identity deck)
   :cards (mapv #(select-keys % [:qty :card]) (:cards deck))})

(defn open! [deck]
  (-> (ensure-engine!)
      (.then (fn []
               (if-let [engine (pnp-engine)]
                 (.call (gobj/get engine "open")
                        engine
                        (clj->js (printable-deck deck))
                        (clj->js
                         {:language (option-name (get-in @app-state [:options :card-language]) "en")
                          :resolution (option-name (get-in @app-state [:options :card-resolution]) "default")
                          :workerUrl (versioned-url worker-path)}))
                 (throw (js/Error. "Jinteki PnP engine did not initialize.")))))
      (.catch (fn [error]
                (.error js/console "[Jinteki PnP]" error)
                (non-game-toast "Jinteki PnP failed to load." "error" nil)))))
