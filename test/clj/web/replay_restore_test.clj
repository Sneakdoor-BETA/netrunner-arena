(ns web.replay-restore-test
  (:require
    [cheshire.core :as json]
    [clojure.test :refer [deftest is testing]]
    [game.core :as core]
    [game.core.diffs :refer [public-states]]
    [game.test-framework :refer [new-game]]
    [web.replay-restore :as replay-restore]))

(defn- move-hand-cards-to-top-of-deck!
  [state side n]
  (doseq [c (take n (get-in @state [side :hand]))]
    (core/move state side c :deck)))

(defn- hand-titles-ordered
  "Ordered :title s in HQ/Grip; enough to verify restore without exposing R&D/Stack in the snapshot."
  [m side]
  (mapv :title (get-in m [side :hand])))

(deftest handle-replay-state-smoketest
  (testing "restores a live game from a JSON replay snapshot (basic smoketest)"
    (let [g1 (new-game)
          _    (doto g1
                 (move-hand-cards-to-top-of-deck! :corp 2)
                 (move-hand-cards-to-top-of-deck! :runner 3))
          target (:hist-state (public-states g1))
          replay (json/generate-string {:history [target]})
          g2 (new-game)
          game {:state g2 :gameid 1}
          out (replay-restore/handle-replay-state game {:replay replay} {:n 0})]
      (is (= game out) "returns the game on success")
      (is (some #(re-find #"Replay restored" (str (get-in % [:public :text])))
                (:log @g2))
          "emits a public log line about replay restore")
      (doseq [side [:corp :runner]]
        (is (= (hand-titles-ordered target side)
               (hand-titles-ordered @g2 side))
            (str (name side) " hand matches the snapshot (order and identity)"))))))
