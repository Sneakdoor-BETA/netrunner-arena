(ns game.core.mark
  (:require
   [game.core.card :refer [get-card]]
   [game.core.engine :refer [trigger-event register-events]]
   [game.core.say :refer [system-msg]]
   [game.core.servers :refer [central->name]]
   [game.core.update :refer [update!]]
   [game.macros :refer [effect]]))

(defn set-mark
  [state new-mark]
  (swap! state assoc :mark new-mark)
  (trigger-event state :runner :mark-changed))

(defn is-mark?
  [state s]
  (= s (:mark @state)))

(defn identify-mark
  [state]
  (let [new-mark (rand-nth [:hq :rd :archives])]
    (set-mark state new-mark)
    (system-msg state :runner (str "identifies [their] mark to be " (central->name new-mark)))))

(def identify-mark-ability
  {:effect (effect (when (nil? (:mark @state)) (identify-mark state)))})

(def mark-changed-event
  {:event :mark-changed
   :silent true
   :interactive (effect false)
   :effect (effect (update! state :runner (assoc card :card-target (central->name (:mark @state))))
                (register-events
                  state side card
                  [{:event :post-runner-turn-ends
                    :silent true
                    :unregister-once-resolved true
                    :effect (effect (when (get-card state card)
                                   (update! state :runner (dissoc (get-card state card) :card-target))))}]))})
