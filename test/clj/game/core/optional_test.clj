(ns game.core.optional-test
  (:require
   [clojure.test :refer :all]
   [game.core :as core]
   [game.core.initializing :refer [make-card]]
   [game.macros :refer [effect]]
   [game.test-framework :refer :all]))

(deftest optional-req
  (let [spy (atom [])]
    (do-game (new-game)
      (core/resolve-ability state :corp
                            {:req (effect (swap! spy conj "outer") true)
                             :optional
                             {:req (effect (swap! spy conj "inner") true)
                              :prompt "Yes or no"
                              :yes-ability {:effect (effect true)}}}
                            (make-card {:title "test"}) nil)
      (is (= ["inner"] @spy) "Only the inner req of optional should be checked"))))
