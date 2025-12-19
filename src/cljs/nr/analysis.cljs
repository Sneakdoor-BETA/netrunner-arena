(ns nr.analysis
  (:require [reagent.core :as r]))

(defn analysis []
  (r/create-class
    {:display-name "analysis"
     :component-did-mount
     (fn [_]
       (when (.getElementById js/document "jnet-stats-root")
         (js/jnetPluginStatsDashboard)))
     :reagent-render
     (fn []
       [:div.page-container
        [:div.stats-bg]
        [:div#jnet-stats-root]])}))
